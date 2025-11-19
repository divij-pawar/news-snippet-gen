import { NextRequest, NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import sharp from 'sharp'

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

    // Use more robust headers to mimic a real browser
    const htmlResponse = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'max-age=0',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
    })

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
        const data = JSON.parse($(element).html() || '{}')

        // Extract Author
        if (!author && data.author) {
          if (Array.isArray(data.author)) {
            author = data.author.map((a: any) => a.name).join(', ')
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
      } catch (e) {
        console.error('Error parsing JSON-LD:', e)
      }
    })

    // Fallback to meta tags and other selectors if JSON-LD didn't provide the data
    if (!author) {
      author = $('meta[name="author"]').attr('content') ||
        $('meta[property="article:author"]').attr('content') ||
        $('[rel="author"]').first().text().trim() ||
        $('.author').first().text().trim() ||
        ''
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

      // Create text overlay SVG with calculated positions (solid white background)
      const separatorY = titleStartY + (titleLines.length - 1) * lineHeight + separatorSpacing
      const metadataStartY = separatorY + separatorHeight + metadataSpacing

      textSvg = `
        <svg width="${width}" height="${textHeight}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${textHeight}" fill="#FFFFFF"/>
          
          <!-- Title -->
          <text 
            x="40" 
            font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" 
            font-size="${titleFontSize}" 
            font-weight="700" 
            fill="#000000"
            letter-spacing="-0.02em"
          >
            ${titleLines.map((line, i) =>
        `<tspan x="40" y="${titleStartY + (i * lineHeight)}">${line}</tspan>`
      ).join('')}
          </text>
          
          <!-- Separator Line -->
          <line x1="40" y1="${separatorY}" x2="${width - 40}" y2="${separatorY}" stroke="#E5E5E5" stroke-width="2"/>
          
          ${metadataBlockHeight > 0 ? `<!-- Metadata -->
          ${includeAuthor ? `<text 
            x="40" 
            font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" 
            font-size="13" 
            font-weight="600" 
            fill="#666666" 
            letter-spacing="0.05em"
          >
            ${authorLines.map((line, i) =>
        `<tspan x="40" y="${metadataStartY + (i * metadataLineHeight)}">${line}</tspan>`
      ).join('')}
          </text>` : ''}
          
          ${includeDate ? `<text 
            x="40" 
            y="${metadataStartY + (includeAuthor ? authorLinesCount * metadataLineHeight : 0)}" 
            font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" 
            font-size="13" 
            font-weight="500" 
            fill="#999999" 
            letter-spacing="0.03em"
          >${cleanSource} • ${cleanDate}</text>` : ''}` : ''}
        </svg>
      `
    } else {
      // VERTICAL IMAGE: Full height image with transparent overlay
      processedImage = await sharp(imageBuffer)
        .resize(width, totalHeight, {
          fit: 'cover',
          position: 'center',
        })
        .toBuffer()

      // Create text overlay SVG with calculated positions (transparent background)
      const separatorY = titleStartY + (titleLines.length - 1) * lineHeight + separatorSpacing
      const metadataStartY = separatorY + separatorHeight + metadataSpacing

      textSvg = `
        <svg width="${width}" height="${textHeight}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${textHeight}" fill="rgba(255, 255, 255, 0.85)"/>
          
          <!-- Title -->
          <text 
            x="40" 
            font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" 
            font-size="${titleFontSize}" 
            font-weight="700" 
            fill="#000000"
            letter-spacing="-0.02em"
          >
            ${titleLines.map((line, i) =>
        `<tspan x="40" y="${titleStartY + (i * lineHeight)}">${line}</tspan>`
      ).join('')}
          </text>
          
          <!-- Separator Line -->
          <line x1="40" y1="${separatorY}" x2="${width - 40}" y2="${separatorY}" stroke="#E5E5E5" stroke-width="2"/>
          
          ${metadataBlockHeight > 0 ? `<!-- Metadata -->
          ${includeAuthor ? `<text 
            x="40" 
            font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" 
            font-size="13" 
            font-weight="600" 
            fill="#666666" 
            letter-spacing="0.05em"
          >
            ${authorLines.map((line, i) =>
        `<tspan x="40" y="${metadataStartY + (i * metadataLineHeight)}">${line}</tspan>`
      ).join('')}
          </text>` : ''}
          
          ${includeDate ? `<text 
            x="40" 
            y="${metadataStartY + (includeAuthor ? authorLinesCount * metadataLineHeight : 0)}" 
            font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" 
            font-size="13" 
            font-weight="500" 
            fill="#999999" 
            letter-spacing="0.03em"
          >${cleanSource} • ${cleanDate}</text>` : ''}` : ''}
        </svg>
      `
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
          top: imageHeight,
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