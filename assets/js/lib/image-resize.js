// Achica la foto en el navegador antes de subirla: menos datos por la red,
// menos espacio en el almacenamiento y menos riesgo de superar los límites de
// Apps Script. También elimina metadatos (ubicación GPS, etc.) al redibujar.

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export function isAcceptedImage(file) {
  return file && ACCEPTED.includes(file.type);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('No se pudo procesar la imagen.'));
    r.readAsDataURL(blob);
  });
}

/**
 * @return {Promise<{mimeType: string, dataBase64: string, bytes: number, width: number, height: number}>}
 */
export async function prepareImage(file, { maxSide = 1600, quality = 0.85 } = {}) {
  if (!isAcceptedImage(file)) throw new Error('Formato no permitido. Usá JPG, PNG o WebP.');
  const img = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx2d = canvas.getContext('2d');
  // PNG con transparencia: fondo blanco al convertir a JPEG/WebP.
  ctx2d.fillStyle = '#ffffff';
  ctx2d.fillRect(0, 0, width, height);
  ctx2d.drawImage(img, 0, 0, width, height);
  let blob = await canvasToBlob(canvas, 'image/webp', quality);
  if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  if (!blob) throw new Error('El navegador no pudo convertir la imagen.');
  return { mimeType: blob.type, dataBase64: await blobToBase64(blob), bytes: blob.size, width, height };
}
