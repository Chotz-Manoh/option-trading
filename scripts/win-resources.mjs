// Adds the app icon, version information and a Windows manifest (run as the normal user, no UAC prompt)
// to the Go-built OptionPulse-Setup.exe.
// Usage: node scripts/win-resources.mjs <exe> <ico> <version>
import fs from 'node:fs'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'

const [exePath, icoPath, version = '1.0.0'] = process.argv.slice(2)
if (!exePath || !icoPath) {
  console.error('usage: node scripts/win-resources.mjs <exe> <ico> <version>')
  process.exit(1)
}
const [ma = 1, mi = 0, pa = 0] = version.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
const LANG = 1033

const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
const res = NtExecutableResource.from(exe)

const ico = Data.IconFile.from(fs.readFileSync(icoPath))
Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, LANG, ico.icons.map((i) => i.data))

const vi = Resource.VersionInfo.createEmpty()
vi.lang = LANG
vi.setFileVersion(ma, mi, pa, 0, LANG)
vi.setProductVersion(ma, mi, pa, 0, LANG)
vi.setStringValues({ lang: LANG, codepage: 1200 }, {
  CompanyName: 'OptionPulse',
  FileDescription: 'OptionPulse — options analysis for Nifty, Bank Nifty and Sensex',
  FileVersion: `${ma}.${mi}.${pa}`,
  InternalName: 'OptionPulse',
  OriginalFilename: 'OptionPulse-Setup.exe',
  ProductName: 'OptionPulse',
  ProductVersion: `${ma}.${mi}.${pa}`,
  LegalCopyright: 'OptionPulse',
})
vi.outputToResourceEntries(res.entries)

const manifest = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity type="win32" name="OptionPulse" version="${ma}.${mi}.${pa}.0"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application><supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/></application>
  </compatibility>
</assembly>
`
const mbin = new TextEncoder().encode(manifest)
res.entries = res.entries.filter((e) => e.type !== 24)
res.entries.push({ type: 24, id: 1, lang: LANG, codepage: 0, bin: mbin.buffer.slice(mbin.byteOffset, mbin.byteOffset + mbin.byteLength) })

res.outputResource(exe)
fs.writeFileSync(exePath, Buffer.from(exe.generate()))
console.log(`resources added to ${exePath} (v${ma}.${mi}.${pa})`)
