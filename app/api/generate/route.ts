import { NextRequest, NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import sharp from 'sharp'

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()

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
    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text() ||
      'Untitled Article'

    const imageUrl =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('meta[property="og:image:url"]').attr('content')

    const author =
      $('meta[name="author"]').attr('content') ||
      $('meta[property="article:author"]').attr('content') ||
      $('.author').first().text().trim() ||
      $('[rel="author"]').first().text().trim() ||
      'Unknown Author'

    const dateStr =
      $('meta[property="article:published_time"]').attr('content') ||
      $('meta[name="publish_date"]').attr('content') ||
      $('time').first().attr('datetime') ||
      new Date().toISOString()

    let date = 'Unknown Date'
    try {
      date = new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    } catch (e) {
      console.error('Error parsing date:', e)
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

    // Generate the square card using Sharp
    const cardSize = 800

    // Resize image to cover the whole square
    const processedImage = await sharp(imageBuffer)
      .resize(cardSize, cardSize, {
        fit: 'cover',
        position: 'center',
      })
      .toBuffer()

    // Clean up title
    const cleanTitle = title.length > 100 ? title.substring(0, 100) + '...' : title
    const cleanAuthor = author.toUpperCase()
    const cleanDate = date.toUpperCase()

    // Create text overlay SVG with gradient background
    const textSvg = `
      <svg width="${cardSize}" height="${cardSize}">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:rgb(0,0,0);stop-opacity:0" />
            <stop offset="50%" style="stop-color:rgb(0,0,0);stop-opacity:0.6" />
            <stop offset="100%" style="stop-color:rgb(0,0,0);stop-opacity:0.9" />
          </linearGradient>
        </defs>
        
        <rect x="0" y="${cardSize / 2}" width="${cardSize}" height="${cardSize / 2}" fill="url(#grad)" />
        
        <text x="40" y="${cardSize - 220}" font-family="Arial, sans-serif" font-size="24" font-weight="600" fill="#ccc" letter-spacing="1">
          ${cleanAuthor} • ${cleanDate}
        </text>
        
        <text x="40" y="${cardSize - 180}" font-family="Arial, sans-serif" font-size="48" font-weight="800" fill="white" style="text-shadow: 0 2px 10px rgba(0,0,0,0.5);">
          ${cleanTitle.split(' ').reduce((lines, word) => {
      const currentLine = lines[lines.length - 1];
      if (currentLine && (currentLine + ' ' + word).length < 25) {
        lines[lines.length - 1] = currentLine + ' ' + word;
      } else {
        lines.push(word);
      }
      return lines;
    }, [''] as string[]).slice(0, 4).map((line, i) =>
      `<tspan x="40" dy="${i === 0 ? 0 : 60}">${line}</tspan>`
    ).join('')}
        </text>
      </svg>
    `

    // Composite the final image
    const finalImage = await sharp(processedImage)
      .composite([
        { input: Buffer.from(textSvg), top: 0, left: 0 },
      ])
      .png()
      .toBuffer()

    // Convert to base64
    const base64Image = `data:image/png;base64,${finalImage.toString('base64')}`

    return NextResponse.json({
      image: base64Image,
      metadata: { title, author, date, imageUrl }
    })

  } catch (error) {
    console.error('[v0] Error generating image:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred while generating the image' },
      { status: 500 }
    )
  }
}
