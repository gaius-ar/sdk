// Synced from gaius/app/src/common/document-files.ts. Run bun run sync:frontend to update.
export const documentFileContentTypes: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/vnd.microsoft.icon',
}

export function documentFileContentType(name: string) {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
  return Object.hasOwn(documentFileContentTypes, extension)
    ? documentFileContentTypes[extension]
    : undefined
}

export const documentFileTypeMessage =
  'Solo se permiten documentos de texto (DOC, DOCX, ODT, RTF, TXT), PDF e imágenes (JPG, JPEG, PNG, GIF, WEBP, BMP, TIF, TIFF, AVIF, HEIC, HEIF, SVG, ICO).'

export const documentFileUploaderProps = {
  description:
    'Documentos de texto (DOC, DOCX, ODT, RTF, TXT), PDF e imágenes.',
  accept: Object.keys(documentFileContentTypes).join(','),
  validateFile: (file: File) => !!documentFileContentType(file.name),
  invalidFileMessage: documentFileTypeMessage,
}
