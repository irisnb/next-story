$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CredReader4 {
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
if (-not [CredReader4]::CredRead("llm-api-key.com.nextstory.desktop", 1, 0, [ref]$ptr)) { Write-Host "CRED_READ_FAILED"; exit 3 }
try {
    $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredReader4+CREDENTIAL])
    $bytes = New-Object byte[] $cred.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
    $key = [Text.Encoding]::Unicode.GetString($bytes).TrimEnd([char]0)
    Write-Host ("CRED_OK length=" + $key.Length)
    $env:REPRO_KEY = $key
    $env:REPRO_WAIT_MS = "100000"
    Set-Location "C:\Users\Administrator\AppData\Local\Temp\opencode\real-chain-check"
    node repro-cancel.mjs
} finally { [CredReader4]::CredFree($ptr) }
