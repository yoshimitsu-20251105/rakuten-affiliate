$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
Set-Location "C:\Users\user\projects\rakuten-affiliate"

$logFile = "C:\Users\user\projects\rakuten-affiliate\pipeline.log"
"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') パイプライン開始 =====" | Out-File -Append -Encoding utf8 $logFile

node --env-file=.env select-products.js *>> $logFile
node generate-site.js *>> $logFile

git add -A
$changes = git status --porcelain
if ($changes) {
  git commit -m "auto: $(Get-Date -Format 'yyyy-MM-dd') 商品選定・サイト更新(要レビュー・push待ち)" *>> $logFile
  "変更をローカルにコミットしました。push前にレビューしてください。" | Out-File -Append -Encoding utf8 $logFile
} else {
  "新規商品なし。変更なし。" | Out-File -Append -Encoding utf8 $logFile
}

"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') パイプライン終了 =====" | Out-File -Append -Encoding utf8 $logFile

