$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
Set-Location "C:\Users\user\projects\rakuten-affiliate"

# タスクスケジューラ実行時(コンソールなし)は [Console]::OutputEncoding が効かないため、
# プロセスのコードページ自体をUTF-8(65001)に切り替えて文字化けを防ぐ
& chcp 65001 > $null
$OutputEncoding = [System.Text.Encoding]::UTF8

$logFile = "C:\Users\user\projects\rakuten-affiliate\pipeline.log"
"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') パイプライン開始 =====" | Out-File -Append -Encoding utf8 $logFile

$nodeExe = (Get-Command node).Source
& cmd /c "`"$nodeExe`" --env-file=.env select-products.js >> `"$logFile`" 2>&1"
& cmd /c "`"$nodeExe`" generate-site.js >> `"$logFile`" 2>&1"

# .env を読み込んでGmailアプリパスワードを取得
Get-Content ".env" | ForEach-Object {
  if ($_ -match '^([^=]+)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
  }
}
$gmailUser = "yoshimitsu.5626@gmail.com"
$appPassword = $env:GMAIL_APP_PASSWORD

function Send-Notify($subject, $body) {
  if (-not $appPassword) {
    "GMAIL_APP_PASSWORD が未設定のため、通知メールは送信されませんでした。" | Out-File -Append -Encoding utf8 $logFile
    return
  }
  try {
    $smtp = New-Object Net.Mail.SmtpClient("smtp.gmail.com", 587)
    $smtp.EnableSsl = $true
    $smtp.Credentials = New-Object Net.NetworkCredential($gmailUser, $appPassword)
    $smtp.Send($gmailUser, $gmailUser, $subject, $body)
    "通知メールを送信しました: $subject" | Out-File -Append -Encoding utf8 $logFile
  } catch {
    "メール送信に失敗しました: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $logFile
  }
}

# APIエラーの検知(新商品の有無に関わらず、エラーがあれば必ずアラートする)
$apiErrorText = ""
if (Test-Path "api-errors.log") {
  $raw = Get-Content "api-errors.log" -Raw
  if ($raw) { $apiErrorText = $raw.Trim() }
}
if ($apiErrorText) {
  "楽天APIエラーを検知しました。" | Out-File -Append -Encoding utf8 $logFile
  Send-Notify "[rakuten-affiliate] 【要確認】楽天APIエラー - $(Get-Date -Format 'yyyy-MM-dd')" `
    "商品選定中に楽天APIエラーが発生しました。IP制限やAPIキーの有効期限などを確認してください。`n`nエラー内容:`n$apiErrorText"
}

git add -A
$changes = git status --porcelain
if ($changes) {
  git commit -m "auto: $(Get-Date -Format 'yyyy-MM-dd') 商品選定・サイト更新" 2>&1 | ForEach-Object { $_.ToString() } | Out-File -Append -Encoding utf8 $logFile
  "ローカルにコミットしました。続けてpushします。" | Out-File -Append -Encoding utf8 $logFile

  git push 2>&1 | ForEach-Object { $_.ToString() } | Out-File -Append -Encoding utf8 $logFile
  if ($LASTEXITCODE -eq 0) {
    "GitHubへのpushが完了しました。" | Out-File -Append -Encoding utf8 $logFile
    Send-Notify "[rakuten-affiliate] サイト更新・公開完了 - $(Get-Date -Format 'yyyy-MM-dd')" `
      "商品選定・サイト更新・GitHubへのpushが完了し、公開サイトに反映されました。`n`n公開サイト: https://yoshimitsu-20251105.github.io/rakuten-affiliate/`nリポジトリ: https://github.com/yoshimitsu-20251105/rakuten-affiliate"
  } else {
    "git push が失敗しました(終了コード $LASTEXITCODE)。" | Out-File -Append -Encoding utf8 $logFile
    Send-Notify "[rakuten-affiliate] 【要確認】push失敗 - $(Get-Date -Format 'yyyy-MM-dd')" `
      "商品選定・サイト更新は完了しましたが、GitHubへのpushに失敗しました。手動で確認してください。`n`nリポジトリ: https://github.com/yoshimitsu-20251105/rakuten-affiliate"
  }
} else {
  "新規商品なし。変更なし。" | Out-File -Append -Encoding utf8 $logFile
}

"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') パイプライン終了 =====" | Out-File -Append -Encoding utf8 $logFile






