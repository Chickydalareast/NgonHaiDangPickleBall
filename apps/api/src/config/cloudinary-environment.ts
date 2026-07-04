import { z } from 'zod';

const optionalCredentialSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional(),
);

const cloudinaryEnvironmentSchema = z
  .object({
    CLOUDINARY_CLOUD_NAME: optionalCredentialSchema,
    CLOUDINARY_API_KEY: optionalCredentialSchema,
    CLOUDINARY_API_SECRET: optionalCredentialSchema,
  })
  .superRefine((value, context) => {
    const configuredValues = [
      value.CLOUDINARY_CLOUD_NAME,
      value.CLOUDINARY_API_KEY,
      value.CLOUDINARY_API_SECRET,
    ].filter((item) => item !== undefined);

    if (configuredValues.length !== 0 && configuredValues.length !== 3) {
      context.addIssue({
        code: 'custom',
        message:
          'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must be configured together.',
      });
    }
  });

export interface CloudinaryEnvironment {
  configured: boolean;
  cloudName: string | null;
  apiKey: string | null;
  apiSecret: string | null;
}

export function readCloudinaryEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): CloudinaryEnvironment {
  const result = cloudinaryEnvironmentSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`Invalid Cloudinary environment:\n${z.prettifyError(result.error)}`);
  }

  const configured = result.data.CLOUDINARY_CLOUD_NAME !== undefined;

  return {
    configured,
    cloudName: result.data.CLOUDINARY_CLOUD_NAME ?? null,
    apiKey: result.data.CLOUDINARY_API_KEY ?? null,
    apiSecret: result.data.CLOUDINARY_API_SECRET ?? null,
  };
}
