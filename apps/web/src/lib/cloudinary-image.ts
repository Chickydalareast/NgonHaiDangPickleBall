export interface CloudinaryImageReference {
  publicId: string;
  version: number | null;
  format: string | null;
}

function encodePublicId(publicId: string): string {
  return publicId.split('/').map(encodeURIComponent).join('/');
}

export function buildCloudinaryImageUrl(
  cloudName: string | null,
  image: CloudinaryImageReference | null,
  transformation = 'f_auto,q_auto,c_fill,w_640,h_480',
): string | null {
  if (!cloudName || !image) {
    return null;
  }

  const versionSegment = image.version === null ? '' : `/v${image.version}`;
  const formatSuffix = image.format ? `.${encodeURIComponent(image.format)}` : '';

  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/upload/${transformation}${versionSegment}/${encodePublicId(image.publicId)}${formatSuffix}`;
}
