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

    // Fetch the article HTML
    const htmlResponse = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    })

    if (!htmlResponse.ok) {
      return NextResponse.json(
        { error: `Failed to fetch article: ${htmlResponse.statusText}` },
        { status: 500 }
      )
    }

    const html = await htmlResponse.text()
    const $ = cheerio.load(html)

    // Extract metadata using Open Graph tags with fallbacks
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
    const imageHeight = Math.floor(cardSize * 0.5)
    const textAreaHeight = cardSize - imageHeight

    // Process and resize the article image
    const processedImage = await sharp(imageBuffer)
      .resize(cardSize, imageHeight, {
        fit: 'cover',
        position: 'center',
      })
      .toBuffer()

    // Clean up title and author for better display
    const cleanTitle = title.length > 120 ? title.substring(0, 120) + '...' : title
    const cleanAuthor = author.toUpperCase()

    // Create text overlay SVG
    const textSvg = `
      <svg width="${cardSize}" height="${textAreaHeight}">
        <rect width="${cardSize}" height="${textAreaHeight}" fill="#ffffff"/>
        
        <text x="${cardSize / 2}" y="60" font-family="Arial, sans-serif" font-size="16" font-weight="600" fill="#666" text-anchor="middle">
          BY: ${cleanAuthor}
        </text>
        
        <foreignObject x="40" y="90" width="${cardSize - 80}" height="${textAreaHeight - 120}">
          <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, sans-serif; font-size: 28px; font-weight: bold; color: #111; text-align: center; line-height: 1.3; display: flex; align-items: center; justify-content: center; height: 100%; padding: 0 20px;">
            ${cleanTitle}
          </div>
        </foreignObject>
      </svg>
    `

    // Composite the final image
    const finalImage = await sharp({
      create: {
        width: cardSize,
        height: cardSize,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([
        { input: processedImage, top: 0, left: 0 },
        { input: Buffer.from(textSvg), top: imageHeight, left: 0 },
      ])
      .png()
      .toBuffer()

    // Convert to base64
    const base64Image = `data:image/png;base64,${finalImage.toString('base64')}`

    return NextResponse.json({ 
      image: base64Image,
      metadata: { title, author, imageUrl }
    })

  } catch (error) {
    console.error('[v0] Error generating image:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred while generating the image' },
      { status: 500 }
    )
  }
}
