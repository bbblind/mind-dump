import sharp from 'sharp';
import { bot } from './bot';
import { logger } from './utils';
import fs from 'fs/promises';
import path from 'path';

/**
 * Download a file from Telegram and return the buffer
 */
async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  try {
    const fileLink = await bot.telegram.getFileLink(fileId);
    const response = await fetch(fileLink.href);
    
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    logger.error({ error, fileId }, 'Failed to download Telegram file');
    throw error;
  }
}

/**
 * Add watermark to image (works for any size/ratio)
 */
async function addWatermark(imageBuffer: Buffer, text: string = '@DurianOnPizza'): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  
  const width = metadata.width || 1280;
  const height = metadata.height || 720;
  
  // Calculate font size based on image dimensions (responsive)
  const fontSize = Math.max(Math.floor(Math.min(width, height) * 0.025), 12); // 2.5% of smallest dimension, min 12px
  const padding = Math.floor(fontSize * 0.8);
  
  // Create SVG with text (bottom-right corner)
  const svgText = `
    <svg width="${width}" height="${height}">
      <text
        x="${width - padding}"
        y="${height - padding}"
        font-family="Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="bold"
        fill="white"
        fill-opacity="0.9"
        text-anchor="end"
        stroke="black"
        stroke-width="${Math.max(1, fontSize / 15)}"
        stroke-opacity="0.6"
      >${text}</text>
    </svg>
  `;
  
  return image
    .composite([{
      input: Buffer.from(svgText),
      blend: 'over'
    }])
    .toBuffer();
}

/**
 * Create a blurred preview of an image with watermark
 * Medium blur as requested (some details visible but heavily obscured)
 * Watermark is added as a sharp overlay AFTER blurring for crisp text
 */
export async function createBlurredImage(fileId: string): Promise<Buffer> {
  try {
    const imageBuffer = await downloadTelegramFile(fileId);
    
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const width = metadata.width || 1280;
    const height = metadata.height || 720;
    
    // Apply medium blur + darken + reduce quality
    const blurred = await sharp(imageBuffer)
      .blur(25) // Medium blur (25 out of possible 1000)
      .modulate({
        brightness: 0.6, // Darken by 40%
        saturation: 0.8  // Reduce saturation slightly
      })
      .toBuffer();
    
    // Add crisp watermark AFTER blurring as an overlay
    // Using sans-serif which works on Alpine Linux (defaults to DejaVu Sans)
    const fontSize = Math.max(Math.floor(Math.min(width, height) * 0.02), 12); // 50% smaller: 2% of smallest dimension, min 12px
    const padding = Math.floor(fontSize * 0.5);
    
    const svgWatermark = `
      <svg width="${width}" height="${height}">
        <text
          x="${width - padding}"
          y="${height - padding}"
          font-family="sans-serif"
          font-size="${fontSize}"
          font-weight="bold"
          fill="white"
          fill-opacity="0.9"
          text-anchor="end"
          stroke="black"
          stroke-width="${Math.max(1, fontSize / 12)}"
          stroke-opacity="0.5"
        >@DurianOnPizza</text>
      </svg>
    `;
    
    const watermarked = await sharp(blurred)
      .composite([{
        input: Buffer.from(svgWatermark),
        blend: 'over'
      }])
      .jpeg({ quality: 75 }) // Higher quality for watermark visibility
      .toBuffer();
    
    logger.info({ originalSize: imageBuffer.length, watermarkedSize: watermarked.length }, 'Created blurred image with watermark');
    
    return watermarked;
  } catch (error) {
    logger.error({ error, fileId }, 'Failed to create blurred image');
    throw error;
  }
}

/**
 * Add watermark to original (unlocked) image
 */
export async function addWatermarkToImage(fileId: string): Promise<Buffer> {
  try {
    const imageBuffer = await downloadTelegramFile(fileId);
    const watermarked = await addWatermark(imageBuffer);
    
    logger.info('Added watermark to original image');
    return watermarked;
  } catch (error) {
    logger.error({ error, fileId }, 'Failed to add watermark to image');
    throw error;
  }
}

/**
 * Create a fully blurred video preview with watermark
 * Uses FFmpeg to blur the entire video while preserving aspect ratio
 */
export async function createVideoThumbnail(fileId: string): Promise<Buffer> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    // Download video
    const videoBuffer = await downloadTelegramFile(fileId);
    
    // Save temporarily
    const timestamp = Date.now();
    const tempInputPath = path.join('/tmp', `video-input-${timestamp}.mp4`);
    const tempOutputPath = path.join('/tmp', `video-output-${timestamp}.mp4`);
    
    await fs.writeFile(tempInputPath, videoBuffer);
    
    // Apply blur filter to entire video using FFmpeg
    // VERY aggressive optimization for speed:
    // - Scale to 480p max (smaller = faster blur)
    // - 10 fps (lower framerate)
    // - boxblur 10:1 (lighter blur, faster processing)
    // - veryfast preset
    // - CRF 35 (lower quality, smaller file)
    // - Limit to 20 seconds
    await execAsync(
      `ffmpeg -i "${tempInputPath}" ` +
      `-vf "scale='min(480,iw)':'min(480,ih)':force_original_aspect_ratio=decrease,` +
      `scale=trunc(iw/2)*2:trunc(ih/2)*2,` + // Round to even dimensions for H.264
      `fps=10,boxblur=10:1,eq=brightness=-0.2:saturation=0.8,` +
      `drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf:` +
      `text='@DurianOnPizza':x=w-tw-10:y=h-th-10:fontsize=18:` +
      `fontcolor=white@0.9:borderw=1.5:bordercolor=black@0.5" ` +
      `-c:v libx264 -preset veryfast -crf 35 -c:a copy -t 20 "${tempOutputPath}" -y`,
      { timeout: 60000 } // 60 second timeout
    );
    
    // Read blurred video
    const blurredVideo = await fs.readFile(tempOutputPath);
    
    // Cleanup
    try {
      await fs.unlink(tempInputPath);
      await fs.unlink(tempOutputPath);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    logger.info({ size: blurredVideo.length }, 'Created fully blurred video preview');
    
    return blurredVideo;
  } catch (error) {
    logger.error({ error, fileId }, 'Failed to create blurred video');
    throw error;
  }
}

/**
 * Upload blurred image/video to Telegram and get file ID
 */
export async function uploadBlurredPreview(
  chatId: number,
  blurredBuffer: Buffer,
  type: 'photo' | 'video'
): Promise<string> {
  try {
    if (type === 'photo') {
      const message = await bot.telegram.sendPhoto(chatId, {
        source: blurredBuffer
      });
      
      const photo = message.photo?.[message.photo.length - 1];
      if (!photo) {
        throw new Error('No photo in uploaded message');
      }
      
      return photo.file_id;
    } else {
      // For video, send the blurred video file
      const message = await bot.telegram.sendVideo(chatId, {
        source: blurredBuffer
      });
      
      const video = message.video;
      if (!video) {
        throw new Error('No video in uploaded message');
      }
      
      return video.file_id;
    }
  } catch (error) {
    logger.error({ error, type }, 'Failed to upload blurred preview');
    throw error;
  }
}
