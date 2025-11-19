import TextToSVG from 'text-to-svg'
import path from 'path'

// Load fonts
const fontsDir = path.join(process.cwd(), 'public', 'fonts')
const textToSVGBold = TextToSVG.loadSync(path.join(fontsDir, 'Inter-Bold.ttf'))
const textToSVGSemiBold = TextToSVG.loadSync(path.join(fontsDir, 'Inter-SemiBold.ttf'))
const textToSVGMedium = TextToSVG.loadSync(path.join(fontsDir, 'Inter-Medium.ttf'))

interface TextBoxOptions {
    width: number
    height: number
    backgroundColor: string
    title: string[]
    titleFontSize: number
    titleLineHeight: number
    author?: string[]
    date?: string
    source?: string
    topPadding: number
    separatorSpacing: number
    metadataSpacing: number
    metadataLineHeight: number
}

export function renderTextBox(options: TextBoxOptions): string {
    let currentY = options.topPadding + (options.titleFontSize * 0.85)

    // Generate title SVG paths
    const titlePaths = options.title.map((line, i) => {
        const y = currentY + (i * options.titleLineHeight)
        const svg = textToSVGBold.getSVG(line, {
            x: 40,
            y: y,
            fontSize: options.titleFontSize,
            anchor: 'left top',
            attributes: { fill: '#000000' }
        })
        // Extract just the path element
        const pathMatch = svg.match(/<path[^>]*d="([^"]*)"[^>]*\/?>/)
        return pathMatch ? `<path d="${pathMatch[1]}" fill="#000000"/>` : ''
    }).join('\n')

    currentY += (options.title.length - 1) * options.titleLineHeight
    currentY += options.separatorSpacing

    const separatorY = currentY
    currentY += 2 + options.metadataSpacing

    // Generate metadata SVG paths
    let metadataPaths = ''
    if (options.author && options.author.length > 0) {
        options.author.forEach((line, i) => {
            const y = currentY + (i * options.metadataLineHeight)
            const svg = textToSVGSemiBold.getSVG(line, {
                x: 40,
                y: y,
                fontSize: 13,
                anchor: 'left top',
                attributes: { fill: '#666666' }
            })
            const pathMatch = svg.match(/<path[^>]*d="([^"]*)"[^>]*\/?>/)
            if (pathMatch) {
                metadataPaths += `<path d="${pathMatch[1]}" fill="#666666"/>\n`
            }
        })
        currentY += options.author.length * options.metadataLineHeight
    }

    if (options.date && options.source) {
        const dateSourceText = `${options.source} • ${options.date}`
        const svg = textToSVGMedium.getSVG(dateSourceText, {
            x: 40,
            y: currentY,
            fontSize: 13,
            anchor: 'left top',
            attributes: { fill: '#999999' }
        })
        const pathMatch = svg.match(/<path[^>]*d="([^"]*)"[^>]*\/?>/)
        if (pathMatch) {
            metadataPaths += `<path d="${pathMatch[1]}" fill="#999999"/>\n`
        }
    }

    // Return complete SVG
    return `
    <svg width="${options.width}" height="${options.height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${options.width}" height="${options.height}" fill="${options.backgroundColor}"/>
      ${titlePaths}
      <line x1="40" y1="${separatorY}" x2="${options.width - 40}" y2="${separatorY}" stroke="#E5E5E5" stroke-width="2"/>
      ${metadataPaths}
    </svg>
  `
}
