import { Capacitor } from '@capacitor/core'
import { download } from './engine'

/** True inside the Android app shell, false in a browser. */
export const isNative = Capacitor.isNativePlatform()

/**
 * Hands a generated file to the user. In a browser this is a normal download;
 * in the Android app (where WebView downloads don't exist) the file is written
 * to the app cache and passed to the system share sheet so it can be saved to
 * Files/Drive, emailed, or opened. Returns false if the user cancelled.
 */
export async function saveFile(filename: string, content: string, type: string): Promise<boolean> {
  if (!isNative) {
    download(filename, content, type)
    return true
  }
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
  const { uri } = await Filesystem.writeFile({ path: filename, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 })
  try {
    await Share.share({ title: filename, files: [uri] })
    return true
  } catch {
    return false // share sheet dismissed
  }
}

/** Standalone HTML copy of a rendered element, with the app's styles inlined. */
export function standaloneHtml(title: string, el: HTMLElement): string {
  let css = ''
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      css += Array.from(sheet.cssRules, (r) => r.cssText).join('\n')
    } catch {
      /* cross-origin sheet: skip */
    }
  }
  const safeTitle = title.replace(/[<>&]/g, '')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safeTitle}</title><style>${css}\nhtml,body{height:auto;background:#fff}body{padding:16px;max-width:900px;margin:0 auto}</style></head><body>${el.innerHTML}</body></html>`
}

/* ------------------------- Android back button ------------------------- */

const backStack: { close: () => void }[] = []

/** Registers something the hardware back button should dismiss first. */
export function pushBack(entry: { close: () => void }): () => void {
  backStack.push(entry)
  return () => {
    const i = backStack.indexOf(entry)
    if (i >= 0) backStack.splice(i, 1)
  }
}

/** Closes the top-most open sheet. Returns false when nothing was open. */
export function closeTop(): boolean {
  const top = backStack[backStack.length - 1]
  if (!top) return false
  top.close()
  return true
}
