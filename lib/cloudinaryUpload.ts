import {
  v2 as cloudinary,
  type UploadApiErrorResponse,
  type UploadApiOptions,
  type UploadApiResponse,
} from 'cloudinary';

type CloudinaryCredentials = {
  cloud_name: string;
  api_key: string;
  api_secret: string;
};

function credentialsFromUrl(value: string | undefined): CloudinaryCredentials | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'cloudinary:' || !parsed.hostname || !parsed.username || !parsed.password) return undefined;
    return {
      cloud_name: parsed.hostname,
      api_key: decodeURIComponent(parsed.username),
      api_secret: decodeURIComponent(parsed.password),
    };
  } catch {
    return undefined;
  }
}

function primaryCredentials(): CloudinaryCredentials | undefined {
  const cloud_name = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const api_key = String(process.env.CLOUDINARY_API_KEY || '').trim();
  const api_secret = String(process.env.CLOUDINARY_API_SECRET || '').trim();
  return cloud_name && api_key && api_secret
    ? { cloud_name, api_key, api_secret }
    : credentialsFromUrl(process.env.CLOUDINARY_URL);
}

function backupCredentials(): CloudinaryCredentials | undefined {
  return credentialsFromUrl(process.env.CLOUDINARY_BACKUP_URL || process.env.CLOUDINARY_URL_BACKUP);
}

function sameAccount(left: CloudinaryCredentials, right: CloudinaryCredentials): boolean {
  return left.cloud_name === right.cloud_name && left.api_key === right.api_key;
}

function errorStatus(error: unknown): number {
  if (!error || typeof error !== 'object') return 0;
  const value = error as Record<string, unknown>;
  const status = Number(value.http_code || value.statusCode || value.status || 0);
  return Number.isFinite(status) ? status : errorStatus(value.error);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return String(error || '');
  const value = error as Record<string, unknown>;
  return [value.message, value.error_description, errorMessage(value.error)]
    .filter(Boolean)
    .join(' ');
}

function isPrimaryAccountUnavailable(error: unknown): boolean {
  const status = errorStatus(error);
  if ([401, 403, 420, 429].includes(status)) return true;
  return /(?:invalid|unknown|disabled|suspended|restricted|blocked)\s+(?:api\s*)?(?:key|account|cloud)|(?:account|cloud)\s+(?:is\s+)?(?:disabled|suspended|restricted|blocked)|invalid signature|quota|usage limit|storage limit|bandwidth limit|monthly limit|plan limit|credit limit|rate limit|too many requests|insufficient (?:quota|credits|storage|bandwidth)/i.test(errorMessage(error));
}

async function withFallback<T>(operation: (credentials: CloudinaryCredentials) => Promise<T>): Promise<T> {
  const primary = primaryCredentials();
  const backup = backupCredentials();
  if (!primary) {
    if (!backup) throw new Error('Cloudinary credentials are not configured');
    return await operation(backup);
  }
  try {
    return await operation(primary);
  } catch (primaryError) {
    if (!backup || sameAccount(primary, backup) || !isPrimaryAccountUnavailable(primaryError)) throw primaryError;
    console.warn('Primary Cloudinary account is unavailable; retrying with backup account.');
    return await operation(backup);
  }
}

export function hasCloudinaryUploadTarget(): boolean {
  return Boolean(primaryCredentials() || backupCredentials());
}

export async function uploadToCloudinary(
  source: string,
  options: UploadApiOptions,
): Promise<UploadApiResponse> {
  return await withFallback(credentials => cloudinary.uploader.upload(source, {
    ...options,
    ...credentials,
    secure: true,
  }));
}

export async function uploadBufferToCloudinary(
  buffer: Buffer,
  options: UploadApiOptions,
): Promise<UploadApiResponse> {
  return await withFallback(credentials => new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { ...options, ...credentials, secure: true },
      (error?: UploadApiErrorResponse, result?: UploadApiResponse) => {
        if (error || !result) reject(error || new Error('Cloudinary upload returned no result'));
        else resolve(result);
      },
    );
    stream.end(buffer);
  }));
}
