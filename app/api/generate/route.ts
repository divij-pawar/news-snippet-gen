import { NextRequest, NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import sharp from 'sharp'
import { renderTextBox } from './textRenderer'

export async function POST(request: NextRequest) {
  try {
    const { url, includeAuthor = true, includeDate = true } = await request.json()

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      )
    }

    // Validate URL format
    try {
      new URL(url)
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { status: 400 }
      )
    }

    console.log('[v0] Fetching URL:', url)

    // Pool of User-Agents to rotate and avoid detection
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    ];

    const getRandomUserAgent = () => userAgents[Math.floor(Math.random() * userAgents.length)];

    // Retry logic with exponential backoff for transient failures
    const maxRetries = 3;
    let htmlResponse;
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        htmlResponse = await fetch(url, {
          headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Referer': 'https://www.google.com/',
            'DNT': '1',
            'Connection': 'keep-alive',
          },
          redirect: 'follow',
        });

        // Only retry on 429 (Too Many Requests) or 5xx errors, not 403/401
        if (htmlResponse.ok || (htmlResponse.status >= 400 && htmlResponse.status < 500)) {
          break;
        }

        // For 5xx, retry with backoff
        if (htmlResponse.status >= 500 && attempt < maxRetries - 1) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          console.log(`[v0] Server error ${htmlResponse.status}, retrying in ${backoffMs}ms...`);
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        break;
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          console.log(`[v0] Network error, retrying in ${backoffMs}ms...`, error);
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }
    }

    if (!htmlResponse) {
      console.error('[v0] Failed to fetch article after retries:', lastError);
      return NextResponse.json(
        { error: `Failed to fetch article: ${lastError instanceof Error ? lastError.message : 'Network error'}` },
        { status: 500 }
      );
    }

    // Handle 403 Forbidden with a user-friendly message
    if (htmlResponse.status === 403) {
      console.error('[v0] Failed to fetch article: 403 Forbidden (site is blocking automated access)');
      return NextResponse.json(
        { error: 'This news site is blocking automated access (403). Try a different article.' },
        { status: 403 }
      )
    }

    if (!htmlResponse.ok) {
      console.error('[v0] Failed to fetch article:', htmlResponse.status, htmlResponse.statusText)
      return NextResponse.json(
        { error: `Failed to fetch article: ${htmlResponse.status} ${htmlResponse.statusText}` },
        { status: htmlResponse.status }
      )
    }

    const html = await htmlResponse.text()
    const $ = cheerio.load(html)

    // Extract News metadata
    const title = $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text() ||
      'Untitled Article'

    const imageUrl = $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('meta[property="og:image:url"]').attr('content') ||
      ''

    let author = ''
    let date = ''
    let source = ''

    // Try to extract from JSON-LD first (most reliable)
    const jsonLdScripts = $('script[type="application/ld+json"]')
    jsonLdScripts.each((_, element) => {
      try {
        const parsed = JSON.parse($(element).html() || '{}')
        
        // Handle both array and object formats (some sites return arrays of schemas)
        const dataArray = Array.isArray(parsed) ? parsed : [parsed]
        
        // Process each schema object in the array
        for (const data of dataArray) {
          // Extract Author
          if (!author && data.author) {
            if (Array.isArray(data.author)) {
              author = data.author.map((a: any) => a.name || a).filter(Boolean).join(', ')
            } else if (typeof data.author === 'object' && data.author.name) {
              author = data.author.name
            } else if (typeof data.author === 'string') {
              author = data.author
            }
          }

          // Extract Source/Publisher
          if (!source && data.publisher) {
            if (typeof data.publisher === 'object' && data.publisher.name) {
              source = data.publisher.name
            } else if (typeof data.publisher === 'string') {
              source = data.publisher
            }
          }

          // Extract Date
          if (!date && data.datePublished) {
            date = data.datePublished
          }
          
          // Stop processing if we found all fields
          if (author && source && date) break
        }
      } catch (e) {
        console.error('Error parsing JSON-LD:', e)
      }
    })

    // Fallback to meta tags and other selectors if JSON-LD didn't provide the data
    if (!author) {
      const metaAuthor = $('meta[name="author"]').attr('content') ||
        $('[rel="author"]').first().text().trim() ||
        $('.author').first().text().trim() ||
        ''
      
      // Handle article:author meta tag which may contain URLs or names
      if (!metaAuthor) {
        const articleAuthor = $('meta[property="article:author"]').attr('content') || ''
        // If it's a URL like "https://www.theguardian.com/profile/hugo-lowell", extract the name
        if (articleAuthor.includes('profile/')) {
          author = articleAuthor
            .split(',')
            .map((url: string) => {
              const match = url.trim().match(/profile\/(.+)$/)
              return match ? match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : ''
            })
            .filter(Boolean)
            .join(', ')
        } else {
          author = articleAuthor
        }
      } else {
        author = metaAuthor
      }
    }

    if (!date) {
      date = $('meta[property="article:published_time"]').attr('content') ||
        $('meta[name="publish_date"]').attr('content') ||
        $('time').first().attr('datetime') ||
        ''
    }

    if (!source) {
      source = $('meta[property="og:site_name"]').attr('content') ||
        $('meta[name="application-name"]').attr('content') ||
        ''
    }

    // Fallback for source if still missing
    if (!source) {
      try {
        const urlObj = new URL(url)
        source = urlObj.hostname.replace('www.', '')
      } catch {
        source = 'Unknown Source'
      }
    }

    // Fallback for author
    if (!author) {
      author = 'Unknown Author'
    }

    // Format date
    let formattedDate = 'Unknown Date'
    try {
      if (date) {
        formattedDate = new Date(date).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })
      } else {
        formattedDate = new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: '2-digit',
          year: 'numeric'
        }).replace(/,/g, '').replace(/ /g, '-')
      }
    } catch {
      formattedDate = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric'
      }).replace(/,/g, '').replace(/ /g, '-')
    }

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'No article image found. Please try a different article.' },
        { status: 400 }
      )
    }

    // Fetch the article image
    let imageBuffer: Buffer
    try {
      const imageResponse = await fetch(imageUrl)
      if (!imageResponse.ok) {
        throw new Error('Failed to fetch image')
      }
      imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
    } catch (error) {
      console.error('[v0] Error fetching image:', error)
      return NextResponse.json(
        { error: 'Failed to fetch article image' },
        { status: 500 }
      )
    }

    // Generate the vertical card
    const width = 800
    const totalHeight = 1000

    // Helper to clean author name
    const cleanAuthorName = (name: string) => {
      if (!name) return ''
      return name
        .replace(/^by\s+/i, '') // Remove "By " prefix
        .replace(/^author:\s+/i, '') // Remove "Author: " prefix
        .replace(/\s+/g, ' ') // Collapse multiple spaces
        .split(/[|•–—]/)[0] // Take first part before separators like |, •, –, —
        .trim()
    }

    // Clean up text
    const cleanTitle = title.length > 150 ? title.substring(0, 150) + '...' : title
    const cleanAuthor = cleanAuthorName(author).toUpperCase()
    const cleanDate = formattedDate.toUpperCase()
    const cleanSource = source.toUpperCase()

    // Word wrap author if too long (max ~60 characters per line for size 13 font)
    const maxAuthorCharsPerLine = 60
    const authorLines = cleanAuthor.split(' ').reduce((lines, word) => {
      const currentLine = lines[lines.length - 1];
      if (currentLine && (currentLine + ' ' + word).length < maxAuthorCharsPerLine) {
        lines[lines.length - 1] = currentLine + ' ' + word;
      } else {
        lines.push(word);
      }
      return lines;
    }, [''] as string[]);

    // Dynamic font size for title
    let titleFontSize = 48
    let lineHeight = 58
    let maxCharsPerLine = 25

    if (cleanTitle.length > 80) {
      titleFontSize = 36
      lineHeight = 44
      maxCharsPerLine = 35
    } else if (cleanTitle.length > 50) {
      titleFontSize = 42
      lineHeight = 50
      maxCharsPerLine = 30
    }

    // Split title into lines
    const titleLines = cleanTitle.split(' ').reduce((lines, word) => {
      const currentLine = lines[lines.length - 1];
      if (currentLine && (currentLine + ' ' + word).length < maxCharsPerLine) {
        lines[lines.length - 1] = currentLine + ' ' + word;
      } else {
        lines.push(word);
      }
      return lines;
    }, [''] as string[]);

    // Calculate required height for text area with tighter spacing
    const topPadding = 20;
    const titleStartY = topPadding + (titleFontSize * 0.85); // Use font size instead of line height for first baseline
    const titleBlockHeight = (titleLines.length - 1) * lineHeight + (titleFontSize * 0.85); // Height from first to last baseline
    const separatorSpacing = 12;
    const separatorHeight = 2;
    const metadataSpacing = 15;
    const metadataLineHeight = 18;
    const authorLinesCount = authorLines.length;

    // Calculate metadata block height based on what's included
    let metadataBlockHeight = 0;
    if (includeAuthor) {
      metadataBlockHeight += authorLinesCount * metadataLineHeight;
    }
    if (includeDate) {
      metadataBlockHeight += metadataLineHeight;
    }
    // If neither is included, we still need some spacing for the source
    if (!includeAuthor && !includeDate) {
      metadataBlockHeight = 0; // No metadata section at all if both are disabled
    }

    const bottomPadding = 20;

    const textHeight = Math.round(topPadding + titleBlockHeight + separatorSpacing + separatorHeight + (metadataBlockHeight > 0 ? metadataSpacing + metadataBlockHeight : 0) + bottomPadding);
    const imageHeight = totalHeight - textHeight;

    // Get image metadata to determine orientation
    const imageMetadata = await sharp(imageBuffer).metadata()
    const isHorizontal = (imageMetadata.width || 0) > (imageMetadata.height || 0)

    let processedImage: Buffer
    let textSvg: string

    if (isHorizontal) {
      // HORIZONTAL IMAGE: Full image at top, solid text box at bottom
      const imageHeight = totalHeight - textHeight

      processedImage = await sharp(imageBuffer)
        .resize(width, imageHeight, {
          fit: 'cover',
          position: 'center',
        })
        .toBuffer()

      // Render text using text-to-svg
      textSvg = renderTextBox({
        width,
        height: textHeight,
        backgroundColor: '#FFFFFF',
        title: titleLines,
        titleFontSize,
        titleLineHeight: lineHeight,
        author: includeAuthor ? authorLines : undefined,
        date: includeDate ? cleanDate : undefined,
        source: cleanSource,
        topPadding,
        separatorSpacing,
        metadataSpacing,
        metadataLineHeight
      })
    } else {
      // VERTICAL IMAGE: Full height image with transparent overlay
      processedImage = await sharp(imageBuffer)
        .resize(width, totalHeight, {
          fit: 'cover',
          position: 'center',
        })
        .toBuffer()

      // Render text using text-to-svg with transparent background
      textSvg = renderTextBox({
        width,
        height: textHeight,
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
        title: titleLines,
        titleFontSize,
        titleLineHeight: lineHeight,
        author: includeAuthor ? authorLines : undefined,
        date: includeDate ? cleanDate : undefined,
        source: cleanSource,
        topPadding,
        separatorSpacing,
        metadataSpacing,
        metadataLineHeight
      })
    }

    // Rounded corners mask
    const maskSvg = `
      <svg width="${width}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${width}" height="${totalHeight}" rx="16" ry="16" fill="white"/>
      </svg>
    `

    // Composite the final image
    const finalImage = await sharp({
      create: {
        width,
        height: totalHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([
        {
          input: processedImage,
          top: 0,
          left: 0
        },
        {
          input: Buffer.from(textSvg),
          top: isHorizontal ? totalHeight - textHeight : totalHeight - textHeight,
          left: 0
        },
        {
          input: Buffer.from(maskSvg),
          blend: 'dest-in'
        }
      ])
      .png()
      .toBuffer()

    // Convert to base64
    const base64Image = `data:image/png;base64,${finalImage.toString('base64')}`

    return NextResponse.json({
      image: base64Image,
      metadata: {
        title,
        author,
        date: formattedDate,
        source,
        imageUrl
      }
    })

  } catch (error) {
    console.error('[v0] Error generating image:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred while generating the image' },
      { status: 500 }
    )
  }
}