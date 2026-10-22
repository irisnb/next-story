$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9223"
Set-Location "D:\Next Story"
npm run tauri:dev 2>&1 | Out-File -FilePath "C:\Users\Administrator\AppData\Local\Temp\opencode\real-chain-check\tauri-dev.log" -Encoding utf8
