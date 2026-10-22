"""Local HTTPS only; byte-for-byte verification using the actual curl bridge."""
import http.server
import json
import pathlib
import re
import ssl
import subprocess
import tempfile
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOTAL = 160 * 1024 * 1024 + 123
PATTERN = bytes(range(251)) * 270


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_):
        pass

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
            pass  # Expected when a probe/cancel rejects the response.

    def do_GET(self):
        mode = self.path.lstrip('/')
        if mode == 'redirect':
            self.send_response(302)
            self.send_header('Location', 'https://drive.google.com/normal')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        total = 2 * 1024 * 1024 + 123 if mode == 'small' else TOTAL
        match = re.fullmatch(r'bytes=(\d+)-(\d+)', self.headers.get('Range', ''))
        start, end = (map(int, match.groups()) if match and mode != 'norange' else (0, total - 1))
        probe = match and start == end == 0
        if mode == 'html':
            self.send_response(200)
            body = b'<html>Google notification</html>'
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        status = 206 if match and mode != 'norange' else 200
        if mode == 'ignored' and not probe:
            status = 200
        self.send_response(status)
        self.send_header('Content-Disposition', 'attachment; filename="fixture.pkg"')
        if mode not in ('noetag', 'existingsequential') and not mode.startswith('date'):
            self.send_header('ETag', '"changed"' if mode == 'changed' and not probe else '"fixture"')
        if mode.startswith('date'):
            value = 'Sat, 01 Jan 2000 10:00:00 GMT'
            if mode == 'datechanged' and not probe:
                value = 'Sat, 01 Jan 2000 10:01:00 GMT'
            if mode == 'dateinvalid':
                value = 'invalid'
            if mode == 'daterecent':
                value = self.date_time_string()
            self.send_header('Last-Modified', value)
            if mode == 'dateweak':
                self.send_header('ETag', 'W/"fixture"')
            if not probe and mode in ('datevalid', 'datechanged'):
                assert self.headers.get('If-Range') == 'Sat, 01 Jan 2000 10:00:00 GMT'
        if status == 206:
            self.send_header('Content-Range', f'bytes {start + (1 if mode == "wrongrange" and not probe else 0)}-{end}/{total}')
        if mode == 'encoding' and not probe:
            self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        try:
            offset = start
            while offset <= end:
                n = min(65536, end - offset + 1)
                local = offset % 251
                self.wfile.write(PATTERN[local:local + n])
                offset += n
                if mode == 'short' and not probe and offset - start >= 1024 * 1024:
                    self.close_connection = True
                    return
                if mode.startswith('bench'):
                    time.sleep(n / (2 * 1024 * 1024))
                elif mode == 'cancel':
                    time.sleep(0.005)
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
            self.close_connection = True


def main():
    with tempfile.TemporaryDirectory(prefix='hldrive-transport-') as directory:
        tmp = pathlib.Path(directory)
        cert, key = tmp / 'cert.pem', tmp / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=drive.google.com', '-addext', 'subjectAltName=DNS:drive.google.com',
                        '-keyout', str(key), '-out', str(cert)], check=True, capture_output=True)
        server = Server(('127.0.0.1', 0), Handler)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        results = []
        try:
            for mode in ['datevalid', 'datechanged', 'dateinvalid', 'daterecent', 'dateweak', 'normal', 'redirect', 'noetag', 'norange', 'small', 'wrongrange', 'changed', 'encoding', 'ignored', 'short', 'html', 'cancel', 'existingparallel', 'existingsequential', 'bench8', 'bench16']:
                run = subprocess.run([str(ROOT / 'build/drive_transport_test'), mode, str(tmp / 'file.part'), str(server.server_port), str(cert)], check=True, capture_output=True, text=True, timeout=90)
                result = json.loads(run.stdout)
                results.append(result)
                print(json.dumps(result), flush=True)
        finally:
            server.shutdown()
            server.server_close()
        (ROOT / 'build/drive-transport-results.json').write_text(json.dumps(results, indent=2))
        a, b = results[-2:]
        print(f'Controlled per-connection cap: 8 workers {a["bytes"] * 8 / a["ms"] / 1000:.1f} Mbps; 16 workers {b["bytes"] * 8 / b["ms"] / 1000:.1f} Mbps. Host test, not PS5 throughput.')


if __name__ == '__main__':
    main()
