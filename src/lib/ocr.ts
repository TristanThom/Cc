import type { OcrResult } from './earnings'
import { isNative } from './native'
import { OfferCapture } from './offers'
import { useStore } from './store'

export async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}

/**
 * Reads the text in a picture on the phone. Returns the image data too, for callers that keep
 * a copy. `testHook` names a window global the browser test suite uses in place of recognition.
 */
export async function readPicture(file: File, index: number, testHook: string): Promise<{ ocr: OcrResult; base64: string | null }> {
  if (isNative) {
    const base64 = await fileToBase64(file)
    return { ocr: await OfferCapture.recognizeImage({ base64 }), base64 }
  }
  const test = (window as unknown as Record<string, OcrResult | OcrResult[] | undefined>)[testHook]
  if (test) return { ocr: Array.isArray(test) ? test[index % test.length] : test, base64: null }
  throw new Error('Reading a picture happens on your phone, so this only works in the Waypoint Android app.')
}

/**
 * If the driver has switched on "keep for checking", stores a copy of the picture together
 * with what was read from it, so the reading can be verified later. Never throws.
 */
export async function keepForCheck(base64: string | null, kind: 'earnings' | 'receipt', ocr: OcrResult, parsed: unknown): Promise<void> {
  if (!isNative || !base64 || !useStore.getState().settings.keepImports) return
  try {
    const { name } = await OfferCapture.saveImage({ base64, kind: 'check' })
    const lines = ocr.lines.map((l) => [l.text, Math.round(l.x), Math.round(l.y), Math.round(l.h)])
    await OfferCapture.saveCheckNote({ name, json: JSON.stringify({ t: Date.now(), kind, size: `${ocr.width}x${ocr.height}`, lines, parsed }) })
  } catch {
    /* keeping a copy is optional */
  }
}
