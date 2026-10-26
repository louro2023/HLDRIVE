// Translate at render time so existing failures follow language changes too.
// Keep unrecognized diagnostics intact rather than guessing their meaning.
export function driveMessage(message, t) {
  if (!message) return ''
  const text = String(message)
  const rules = [
    ['googleAccessLimited', /Google recusou o acesso: permissão, cota ou limite de downloads/i],
    ['googleQuota', /download quota|quota exceeded|too many users have (?:viewed|downloaded)|download limit|cota de downloads|cuota de descarga/i],
    ['googleNotFound', /Arquivo ou pasta não encontrado no Google Drive|file (?:you have requested )?does not exist|file not found|requested (?:file|url) was not found/i],
    ['googlePermission', /you (?:do not|don't) have (?:permission|access)|access denied|request access|you need access|permission denied/i],
    ['googleLogin', /(?:sign|log) in to (?:your |a )?(?:google|account)|requires? (?:a )?(?:login|sign.in)|authentication required/i],
    ['googleVirus', /(?:infected with|contains|detected a) (?:a )?virus|violates? (?:our |google.*)?terms of service|abuse/i],
    ['googleConfirmationDone', /^Confirmação de download do Google Drive processada automaticamente/],
    ['googleConfirmationLoop', /^O Google repetiu a confirmação/],
    ['googleUnknownWarning', /^O Google retornou um aviso de download não reconhecido|^Google retornou uma página de confirmação ou erro/],
    ['googleBusy', /^O Drive está ocupado com outra transferência/],
    ['googleListingFailed', /^Não foi possível listar a pasta pública/],
  ]
  for (const [key, pattern] of rules) {
    if (pattern.test(text)) return t(`hldrive.${key}`)
  }
  if (text.startsWith('Aviso do Google Drive:')) return t('hldrive.googleUnknownWarning')
  return text
}
