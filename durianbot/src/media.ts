import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { CONTENT_WATERMARK_TEXT } from './config';
import { logger } from './utils';
import bot from './bot';

const execAsync = promisify(exec);

// Media processing interface
export interface MediaProcessingOptions {
  type: 'photo' | 'video';
  fileId: string;
  caption?: string;
  watermark?: boolean;
}

export interface ProcessedMedia {
  fileId: string;
  caption?: string;
  originalFileId: string;
}

// Ensure temp directory exists
const TEMP_DIR = path.join(process.cwd(), 'temp');

const ensureTempDir = async () => {
  if (!existsSync(TEMP_DIR)) {
    await mkdir(TEMP_DIR, { recursive: true });
  }
};

// Check if FFmpeg is available
let ffmpegAvailable: boolean | null = null;

const checkFFmpegAvailability = async (): Promise<boolean> => {
  if (ffmpegAvailable !== null) {
    return ffmpegAvailable;
  }

  try {
    await execAsync('ffmpeg -version');
    ffmpegAvailable = true;
    logger.info('FFmpeg is available for media processing');
  } catch (error) {
    ffmpegAvailable = false;
    logger.warn('FFmpeg is not available, watermarking disabled');
  }

  return ffmpegAvailable;
};

// Download file from Telegram
const downloadTelegramFile = async (fileId: string): Promise<string> => {
  try {
    // Get file info from Telegram
    const file = await bot.telegram.getFile(fileId);
    if (!file.file_path) {
      throw new Error('File path not available');
    }

    // Get file URL
    const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
    
    // Download file
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    
    // Save to temp file
    const extension = path.extname(file.file_path) || '.tmp';
    const tempFilePath = path.join(TEMP_DIR, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${extension}`);
    
    await writeFile(tempFilePath, Buffer.from(buffer));
    
    logger.debug({ fileId, tempFilePath }, 'Downloaded Telegram file');
    return tempFilePath;
  } catch (error) {
    logger.error({ error, fileId }, 'Failed to download Telegram file');
    throw error;
  }
};

// Upload file to Telegram and get new file_id
const uploadTelegramFile = async (filePath: string, type: 'photo' | 'video'): Promise<string> => {
  try {
    // Create a temporary chat to upload the file
    // We'll send it to the bot itself to get the file_id
    const botInfo = await bot.telegram.getMe();
    
    let message;
    if (type === 'photo') {
      message = await bot.telegram.sendPhoto(botInfo.id, { source: filePath });
    } else {
      message = await bot.telegram.sendVideo(botInfo.id, { source: filePath });
    }

    // Extract file_id from the uploaded message
    let newFileId: string;
    if (type === 'photo' && 'photo' in message) {
      newFileId = message.photo[message.photo.length - 1]!.file_id;
    } else if (type === 'video' && 'video' in message) {
      newFileId = message.video.file_id;
    } else {
      throw new Error('Failed to get file_id from uploaded message');
    }

    // Delete the temporary message
    try {
      await bot.telegram.deleteMessage(botInfo.id, message.message_id);
    } catch (deleteError) {
      // Ignore delete errors
      logger.warn({ deleteError }, 'Failed to delete temporary message');
    }

    logger.debug({ filePath, newFileId, type }, 'Uploaded file to Telegram');
    return newFileId;
  } catch (error) {
    logger.error({ error, filePath, type }, 'Failed to upload file to Telegram');
    throw error;
  }
};

// Apply watermark to image using FFmpeg
const watermarkImage = async (inputPath: string, outputPath: string, watermarkText: string): Promise<void> => {
  try {
    // FFmpeg command to add text watermark
    const command = [
      'ffmpeg',
      '-i', `"${inputPath}"`,
      '-vf', `"drawtext=text='${watermarkText}':fontsize=24:fontcolor=white@0.8:x=w-tw-20:y=h-th-20:box=1:boxcolor=black@0.5:boxborderw=5"`,
      '-y', // Overwrite output file
      `"${outputPath}"`
    ].join(' ');

    await execAsync(command);
    logger.debug({ inputPath, outputPath, watermarkText }, 'Applied watermark to image');
  } catch (error) {
    logger.error({ error, inputPath, outputPath, watermarkText }, 'Failed to apply watermark to image');
    throw error;
  }
};

// Apply watermark to video using FFmpeg
const watermarkVideo = async (inputPath: string, outputPath: string, watermarkText: string): Promise<void> => {
  try {
    // FFmpeg command to add text watermark to video
    const command = [
      'ffmpeg',
      '-i', `"${inputPath}"`,
      '-vf', `"drawtext=text='${watermarkText}':fontsize=24:fontcolor=white@0.8:x=w-tw-20:y=h-th-20:box=1:boxcolor=black@0.5:boxborderw=5"`,
      '-c:a', 'copy', // Copy audio without re-encoding
      '-y', // Overwrite output file
      `"${outputPath}"`
    ].join(' ');

    await execAsync(command);
    logger.debug({ inputPath, outputPath, watermarkText }, 'Applied watermark to video');
  } catch (error) {
    logger.error({ error, inputPath, outputPath, watermarkText }, 'Failed to apply watermark to video');
    throw error;
  }
};

// Clean up temporary files
const cleanupTempFiles = async (filePaths: string[]) => {
  for (const filePath of filePaths) {
    try {
      await unlink(filePath);
      logger.debug({ filePath }, 'Cleaned up temporary file');
    } catch (error) {
      logger.warn({ error, filePath }, 'Failed to clean up temporary file');
    }
  }
};

// Main media processing function
export const processMedia = async (options: MediaProcessingOptions): Promise<ProcessedMedia> => {
  const { type, fileId, caption, watermark = true } = options;
  
  try {
    await ensureTempDir();
    
    // If watermarking is disabled or no watermark text, return original
    if (!watermark || !CONTENT_WATERMARK_TEXT) {
      logger.debug({ fileId, type }, 'Watermarking disabled, returning original file');
      return {
        fileId,
        caption,
        originalFileId: fileId,
      };
    }

    // Check if FFmpeg is available
    const hasFFmpeg = await checkFFmpegAvailability();
    if (!hasFFmpeg) {
      logger.warn('FFmpeg not available, returning original file');
      return {
        fileId,
        caption,
        originalFileId: fileId,
      };
    }

    logger.info({ fileId, type, watermarkText: CONTENT_WATERMARK_TEXT }, 'Processing media with watermark');

    // Download original file
    const inputPath = await downloadTelegramFile(fileId);
    const extension = path.extname(inputPath);
    const outputPath = path.join(TEMP_DIR, `watermarked-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${extension}`);

    try {
      // Apply watermark based on media type
      if (type === 'photo') {
        await watermarkImage(inputPath, outputPath, CONTENT_WATERMARK_TEXT);
      } else {
        await watermarkVideo(inputPath, outputPath, CONTENT_WATERMARK_TEXT);
      }

      // Upload watermarked file back to Telegram
      const newFileId = await uploadTelegramFile(outputPath, type);

      // Add watermark notice to caption
      const watermarkNotice = `\n\n🔒 Content protected by ${CONTENT_WATERMARK_TEXT}`;
      const newCaption = caption ? caption + watermarkNotice : watermarkNotice.trim();

      logger.info({ originalFileId: fileId, newFileId, type }, 'Successfully processed media with watermark');

      return {
        fileId: newFileId,
        caption: newCaption,
        originalFileId: fileId,
      };
    } finally {
      // Clean up temporary files
      await cleanupTempFiles([inputPath, outputPath]);
    }
  } catch (error) {
    logger.error({ error, fileId, type }, 'Failed to process media, returning original');
    
    // Return original file if processing fails
    return {
      fileId,
      caption,
      originalFileId: fileId,
    };
  }
};

// Generate thumbnail for video (optional)
export const generateVideoThumbnail = async (videoFileId: string): Promise<string | null> => {
  try {
    const hasFFmpeg = await checkFFmpegAvailability();
    if (!hasFFmpeg) {
      return null;
    }

    await ensureTempDir();

    // Download video file
    const videoPath = await downloadTelegramFile(videoFileId);
    const thumbnailPath = path.join(TEMP_DIR, `thumb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`);

    try {
      // Generate thumbnail at 5 seconds
      const command = [
        'ffmpeg',
        '-i', `"${videoPath}"`,
        '-ss', '00:00:05', // Seek to 5 seconds
        '-vframes', '1', // Extract 1 frame
        '-q:v', '2', // High quality
        '-y', // Overwrite output file
        `"${thumbnailPath}"`
      ].join(' ');

      await execAsync(command);

      // Upload thumbnail to Telegram
      const thumbnailFileId = await uploadTelegramFile(thumbnailPath, 'photo');

      logger.debug({ videoFileId, thumbnailFileId }, 'Generated video thumbnail');
      return thumbnailFileId;
    } finally {
      // Clean up temporary files
      await cleanupTempFiles([videoPath, thumbnailPath]);
    }
  } catch (error) {
    logger.error({ error, videoFileId }, 'Failed to generate video thumbnail');
    return null;
  }
};

// Validate media file
export const validateMediaFile = (type: 'photo' | 'video', fileSize?: number): { valid: boolean; message?: string } => {
  const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10MB
  const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB

  if (type === 'photo' && fileSize && fileSize > MAX_PHOTO_SIZE) {
    return {
      valid: false,
      message: 'Photo file size exceeds 10MB limit',
    };
  }

  if (type === 'video' && fileSize && fileSize > MAX_VIDEO_SIZE) {
    return {
      valid: false,
      message: 'Video file size exceeds 50MB limit',
    };
  }

  return { valid: true };
};

// Media utilities
export const mediaUtils = {
  processMedia,
  generateVideoThumbnail,
  validateMediaFile,
  checkFFmpegAvailability,
};

export default mediaUtils;
import { promisify } from 'util';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { CONTENT_WATERMARK_TEXT } from './config';
import { logger } from './utils';
import bot from './bot';

const execAsync = promisify(exec);

// Media processing interface
export interface MediaProcessingOptions {
  type: 'photo' | 'video';
  fileId: string;
  caption?: string;
  watermark?: boolean;
}

export interface ProcessedMedia {
  fileId: string;
  caption?: string;
  originalFileId: string;
}

// Ensure temp directory exists
const TEMP_DIR = path.join(process.cwd(), 'temp');

const ensureTempDir = async () => {
  if (!existsSync(TEMP_DIR)) {
    await mkdir(TEMP_DIR, { recursive: true });
  }
};

// Check if FFmpeg is available
let ffmpegAvailable: boolean | null = null;

const checkFFmpegAvailability = async (): Promise<boolean> => {
  if (ffmpegAvailable !== null) {
    return ffmpegAvailable;
  }

  try {
    await execAsync('ffmpeg -version');
    ffmpegAvailable = true;
    logger.info('FFmpeg is available for media processing');
  } catch (error) {
    ffmpegAvailable = false;
    logger.warn('FFmpeg is not available, watermarking disabled');
  }

  return ffmpegAvailable;
};

// Download file from Telegram
const downloadTelegramFile = async (fileId: string): Promise<string> => {
  try {
    // Get file info from Telegram
    const file = await bot.telegram.getFile(fileId);
    if (!file.file_path) {
      throw new Error('File path not available');
    }

    // Get file URL
    const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
    
    // Download file
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    
    // Save to temp file
    const extension = path.extname(file.file_path) || '.tmp';
    const tempFilePath = path.join(TEMP_DIR, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${extension}`);
    
    await writeFile(tempFilePath, Buffer.from(buffer));
    
    logger.debug({ fileId, tempFilePath }, 'Downloaded Telegram file');
    return tempFilePath;
  } catch (error) {
    logger.error({ error, fileId }, 'Failed to download Telegram file');
    throw error;
  }
};

// Upload file to Telegram and get new file_id
const uploadTelegramFile = async (filePath: string, type: 'photo' | 'video'): Promise<string> => {
  try {
    // Create a temporary chat to upload the file
    // We'll send it to the bot itself to get the file_id
    const botInfo = await bot.telegram.getMe();
    
    let message;
    if (type === 'photo') {
      message = await bot.telegram.sendPhoto(botInfo.id, { source: filePath });
    } else {
      message = await bot.telegram.sendVideo(botInfo.id, { source: filePath });
    }

    // Extract file_id from the uploaded message
    let newFileId: string;
    if (type === 'photo' && 'photo' in message) {
      newFileId = message.photo[message.photo.length - 1]!.file_id;
    } else if (type === 'video' && 'video' in message) {
      newFileId = message.video.file_id;
    } else {
      throw new Error('Failed to get file_id from uploaded message');
    }

    // Delete the temporary message
    try {
      await bot.telegram.deleteMessage(botInfo.id, message.message_id);
    } catch (deleteError) {
      // Ignore delete errors
      logger.warn({ deleteError }, 'Failed to delete temporary message');
    }

    logger.debug({ filePath, newFileId, type }, 'Uploaded file to Telegram');
    return newFileId;
  } catch (error) {
    logger.error({ error, filePath, type }, 'Failed to upload file to Telegram');
    throw error;
  }
};

// Apply watermark to image using FFmpeg
const watermarkImage = async (inputPath: string, outputPath: string, watermarkText: string): Promise<void> => {
  try {
    // FFmpeg command to add text watermark
    const command = [
      'ffmpeg',
      '-i', `"${inputPath}"`,
      '-vf', `"drawtext=text='${watermarkText}':fontsize=24:fontcolor=white@0.8:x=w-tw-20:y=h-th-20:box=1:boxcolor=black@0.5:boxborderw=5"`,
      '-y', // Overwrite output file
      `"${outputPath}"`
    ].join(' ');

    await execAsync(command);
    logger.debug({ inputPath, outputPath, watermarkText }, 'Applied watermark to image');
  } catch (error) {
    logger.error({ error, inputPath, outputPath, watermarkText }, 'Failed to apply watermark to image');
    throw error;
  }
};

// Apply watermark to video using FFmpeg
const watermarkVideo = async (inputPath: string, outputPath: string, watermarkText: string): Promise<void> => {
  try {
    // FFmpeg command to add text watermark to video
    const command = [
      'ffmpeg',
      '-i', `"${inputPath}"`,
      '-vf', `"drawtext=text='${watermarkText}':fontsize=24:fontcolor=white@0.8:x=w-tw-20:y=h-th-20:box=1:boxcolor=black@0.5:boxborderw=5"`,
      '-c:a', 'copy', // Copy audio without re-encoding
      '-y', // Overwrite output file
      `"${outputPath}"`
    ].join(' ');

    await execAsync(command);
    logger.debug({ inputPath, outputPath, watermarkText }, 'Applied watermark to video');
  } catch (error) {
    logger.error({ error, inputPath, outputPath, watermarkText }, 'Failed to apply watermark to video');
    throw error;
  }
};

// Clean up temporary files
const cleanupTempFiles = async (filePaths: string[]) => {
  for (const filePath of filePaths) {
    try {
      await unlink(filePath);
      logger.debug({ filePath }, 'Cleaned up temporary file');
    } catch (error) {
      logger.warn({ error, filePath }, 'Failed to clean up temporary file');
    }
  }
};

// Main media processing function
export const processMedia = async (options: MediaProcessingOptions): Promise<ProcessedMedia> => {
  const { type, fileId, caption, watermark = true } = options;
  
  try {
    await ensureTempDir();
    
    // If watermarking is disabled or no watermark text, return original
    if (!watermark || !CONTENT_WATERMARK_TEXT) {
      logger.debug({ fileId, type }, 'Watermarking disabled, returning original file');
      return {
        fileId,
        caption,
        originalFileId: fileId,
      };
    }

    // Check if FFmpeg is available
    const hasFFmpeg = await checkFFmpegAvailability();
    if (!hasFFmpeg) {
      logger.warn('FFmpeg not available, returning original file');
      return {
        fileId,
        caption,
        originalFileId: fileId,
      };
    }

    logger.info({ fileId, type, watermarkText: CONTENT_WATERMARK_TEXT }, 'Processing media with watermark');

    // Download original file
    const inputPath = await downloadTelegramFile(fileId);
    const extension = path.extname(inputPath);
    const outputPath = path.join(TEMP_DIR, `watermarked-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${extension}`);

    try {
      // Apply watermark based on media type
      if (type === 'photo') {
        await watermarkImage(inputPath, outputPath, CONTENT_WATERMARK_TEXT);
      } else {
        await watermarkVideo(inputPath, outputPath, CONTENT_WATERMARK_TEXT);
      }

      // Upload watermarked file back to Telegram
      const newFileId = await uploadTelegramFile(outputPath, type);

      // Add watermark notice to caption
      const watermarkNotice = `\n\n🔒 Content protected by ${CONTENT_WATERMARK_TEXT}`;
      const newCaption = caption ? caption + watermarkNotice : watermarkNotice.trim();

      logger.info({ originalFileId: fileId, newFileId, type }, 'Successfully processed media with watermark');

      return {
        fileId: newFileId,
        caption: newCaption,
        originalFileId: fileId,
      };
    } finally {
      // Clean up temporary files
      await cleanupTempFiles([inputPath, outputPath]);
    }
  } catch (error) {
    logger.error({ error, fileId, type }, 'Failed to process media, returning original');
    
    // Return original file if processing fails
    return {
      fileId,
      caption,
      originalFileId: fileId,
    };
  }
};

// Generate thumbnail for video (optional)
export const generateVideoThumbnail = async (videoFileId: string): Promise<string | null> => {
  try {
    const hasFFmpeg = await checkFFmpegAvailability();
    if (!hasFFmpeg) {
      return null;
    }

    await ensureTempDir();

    // Download video file
    const videoPath = await downloadTelegramFile(videoFileId);
    const thumbnailPath = path.join(TEMP_DIR, `thumb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`);

    try {
      // Generate thumbnail at 5 seconds
      const command = [
        'ffmpeg',
        '-i', `"${videoPath}"`,
        '-ss', '00:00:05', // Seek to 5 seconds
        '-vframes', '1', // Extract 1 frame
        '-q:v', '2', // High quality
        '-y', // Overwrite output file
        `"${thumbnailPath}"`
      ].join(' ');

      await execAsync(command);

      // Upload thumbnail to Telegram
      const thumbnailFileId = await uploadTelegramFile(thumbnailPath, 'photo');

      logger.debug({ videoFileId, thumbnailFileId }, 'Generated video thumbnail');
      return thumbnailFileId;
    } finally {
      // Clean up temporary files
      await cleanupTempFiles([videoPath, thumbnailPath]);
    }
  } catch (error) {
    logger.error({ error, videoFileId }, 'Failed to generate video thumbnail');
    return null;
  }
};

// Validate media file
export const validateMediaFile = (type: 'photo' | 'video', fileSize?: number): { valid: boolean; message?: string } => {
  const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10MB
  const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB

  if (type === 'photo' && fileSize && fileSize > MAX_PHOTO_SIZE) {
    return {
      valid: false,
      message: 'Photo file size exceeds 10MB limit',
    };
  }

  if (type === 'video' && fileSize && fileSize > MAX_VIDEO_SIZE) {
    return {
      valid: false,
      message: 'Video file size exceeds 50MB limit',
    };
  }

  return { valid: true };
};

// Media utilities
export const mediaUtils = {
  processMedia,
  generateVideoThumbnail,
  validateMediaFile,
  checkFFmpegAvailability,
};

export default mediaUtils;