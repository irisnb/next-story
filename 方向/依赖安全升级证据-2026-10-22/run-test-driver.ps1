$ErrorActionPreference = "Stop"
# Read app credential via CredRead; decode blob as UTF-16LE (keyring 3.6.3 windows-native
# writes encode_utf16 + trailing null). Key stays in-process (env var), never printed/saved.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CredReader3 {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags; public int Type; public string TargetName; public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
        public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
    [DllImport("advapi32.dll")]
    public static extern void CredFree(IntPtr cred);
}
"@
$ptr = [IntPtr]::Zero
if (-not [CredReader3]::CredRead("llm-api-key.com.nextstory.desktop", 1, 0, [ref]$ptr)) { Write-Host "CRED_READ_FAILED"; exit 3 }
try {
    $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredReader3+CREDENTIAL])
    if ($cred.CredentialBlobSize -le 0) { Write-Host "CRED_EMPTY"; exit 3 }
    $bytes = New-Object byte[] $cred.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
    $key = [Text.Encoding]::Unicode.GetString($bytes).TrimEnd([char]0)
    if ([string]::IsNullOrWhiteSpace($key)) { Write-Host "CRED_EMPTY_AFTER_DECODE"; exit 3 }
    Write-Host ("CRED_OK length=" + $key.Length)
    $env:DEEPSEEK_API_KEY = $key
    Set-Location "D:\Next Story\sidecar\driver"
    node test-driver.mjs "https://open.bigmodel.cn/api/coding/paas/v4" "glm-5.3"
    exit $LASTEXITCODE
} finally { [CredReader3]::CredFree($ptr) }
