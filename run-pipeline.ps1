$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
Set-Location "C:\Users\user\projects\rakuten-affiliate"

$logFile = "C:\Users\user\projects\rakuten-affiliate\pipeline.log"
"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') パイプライン開始 =====" | Out-File -Append -Encoding utf8 $logFile

node --env-file=.env select-products.js *>> $logFile
node generate-site.js *>> $logFile

git add -A
$changes = git status --porcelain
$pushOk = $false
$pushError = ""
if ($changes) {
  git commit -m "auto: $(Get-Date -Format 'yyyy-MM-dd') 商品選定・サイト更新" *>> $logFile
  "ローカルにコミットしました。続けてpushします。" | Out-File -Append -Encoding utf8 $logFile

  git push *>> $logFile
  if ($LASTEXITCODE -eq 0) {
    $pushOk = $true
    "GitHubへのpushが完了しました。" | Out-File -Append -Encoding utf8 $logFile
  } else {
    $pushError = "git push が失敗しました(終了コード $LASTEXITCODE)。ログを確認してください。"
    $pushError | Out-File -Append -Encoding utf8 $logFile
  }

  # .env を読み込んでGmailアプリパスワードを取得
  Get-Content ".env" | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') {
      [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
    }
  }
  $gmailUser = "yoshimitsu.5626@gmail.com"
  $appPassword = $env:GMAIL_APP_PASSWORD

  if ($appPassword) {
    try {
      $smtp = New-Object Net.Mail.SmtpClient("smtp.gmail.com", 587)
      $smtp.EnableSsl = $true
      $smtp.Credentials = New-Object Net.NetworkCredential($gmailUser, $appPassword)
      if ($pushOk) {
        $subject = "[rakuten-affiliate] サイト更新・公開完了 - $(Get-Date -Format 'yyyy-MM-dd')"
        $body = "商品選定・サイト更新・GitHubへのpushが完了し、公開サイトに反映されました。`n`n公開サイト: https://yoshimitsu-20251105.github.io/rakuten-affiliate/`nリポジトリ: https://github.com/yoshimitsu-20251105/rakuten-affiliate"
      } else {
        $subject = "[rakuten-affiliate] 【要確認】push失敗 - $(Get-Date -Format 'yyyy-MM-dd')"
        $body = "商品選定・サイト更新は完了しましたが、GitHubへのpushに失敗しました。手動で確認してください。`n`nエラー: $pushError`nリポジトリ: https://github.com/yoshimitsu-20251105/rakuten-affiliate"
      }
      $smtp.Send($gmailUser, $gmailUser, $subject, $body)
      "通知メールを送信しました。" | Out-File -Append -Encoding utf8 $logFile
    } catch {
      "メール送信に失敗しました: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $logFile
    }
  } else {
    "GMAIL_APP_PASSWORD が未設定のため、通知メールは送信されませんでした。" | Out-File -Append -Encoding utf8 $logFile
  }
} else {
  "新規商品なし。変更なし。" | Out-File -Append -Encoding utf8 $logFile
}

"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') パイプライン終了 =====" | Out-File -Append -Encoding utf8 $logFile



