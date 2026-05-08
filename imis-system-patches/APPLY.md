# How to apply these IMIS-SYSTEM patches

These 13 git patches fix the IMIS-SYSTEM login and runtime. They were
prepared in a Cloud Agent that did not have write access to the
`imis-system` repo, so they're delivered here as files.

## Apply them in 4 PowerShell commands

```powershell
# 1. Download the patches anywhere on your laptop:
cd $env:USERPROFILE\Desktop
git clone -b cursor/imis-system-patches-3b70 https://github.com/edwinkasienyo-ai/Kasienyo.git kasienyo-patches

# 2. Switch into your imis-system project:
cd $env:USERPROFILE\Desktop\imis-system

# 3. Make sure your working tree is clean (commit or stash any local changes first!):
git status

# 4. Apply all 13 patches in order:
git am ..\kasienyo-patches\imis-system-patches\*.patch
```

## After applying

```powershell
# Verify
git log --oneline -15

# You should see 13 new commits ending in "Move real frontend out of backend"
# Push them to the imis-system origin:
git push origin main
```

## Then run the system

```powershell
# In one PowerShell window:
cd $env:USERPROFILE\Desktop\imis-system\backend
copy .env.example .env
npm install
npm run dev

# In a SECOND PowerShell window:
cd $env:USERPROFILE\Desktop\imis-system\imis-frontend
npm install
npm start
```

Default login (visible on the backend startup banner):

| Username | Password      | Role               |
| -------- | ------------- | ------------------ |
| `admin`  | `Admin@1234`  | HOI/ADMINISTRATOR  |
| `sysdev` | `Sysdev@1234` | SYSTEM DEVELOPER   |

The OTP is shown both in the alert that pops up after **Send OTP**
and in the backend's PowerShell window (look for `[OTP]`).

## If `git am` fails

Run `git am --abort` and try the alternative — apply each patch
individually:

```powershell
foreach ($p in (Get-ChildItem ..\kasienyo-patches\imis-system-patches\*.patch | Sort-Object Name)) {
  git am $p.FullName
  if ($LASTEXITCODE -ne 0) { Write-Host "Failed at: $($p.Name)" -ForegroundColor Red; break }
}
```
