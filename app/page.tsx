'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Download, Loader2, Link2, ImageIcon } from 'lucide-react'

export default function Home() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<{ title: string; author: string; date: string } | null>(null)
  const [includeAuthor, setIncludeAuthor] = useState(true)
  const [includeDate, setIncludeDate] = useState(true)

  const handleGenerate = async () => {
    if (!url.trim()) {
      setError('Please enter a valid URL')
      return
    }

    try {
      new URL(url)
    } catch {
      setError('Please enter a valid URL format')
      return
    }

    setLoading(true)
    setError('')
    setGeneratedImage(null)
    setMetadata(null)

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, includeAuthor, includeDate }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate image')
      }

      setGeneratedImage(data.image)
      setMetadata(data.metadata)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    if (!generatedImage) return

    const link = document.createElement('a')
    link.href = generatedImage
    link.download = 'article-card.png'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-12 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
            <ImageIcon className="size-4" />
            <span>News to Image Converter</span>
          </div>
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl text-balance">
            Transform Articles into Shareable Graphics
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground text-pretty">
            Paste any news article URL and instantly generate a beautiful, square social media graphic with the article's image, title, and author.
          </p>
        </div>

        {/* Input Section */}
        <Card className="p-6 shadow-lg sm:p-8">
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Link2 className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="url"
                  placeholder="https://www.example.com/article..."
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value)
                    setError('')
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                  className="h-12 pl-10 text-base"
                  disabled={loading}
                />
              </div>
              <Button
                onClick={handleGenerate}
                disabled={loading || !url.trim()}
                size="lg"
                className="h-12 min-w-[140px] font-semibold"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 size-5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate'
                )}
              </Button>
            </div>

            {/* Options */}
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-author"
                  checked={includeAuthor}
                  onCheckedChange={(checked) => setIncludeAuthor(checked as boolean)}
                  disabled={loading}
                />
                <Label
                  htmlFor="include-author"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Include Author
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-date"
                  checked={includeDate}
                  onCheckedChange={(checked) => setIncludeDate(checked as boolean)}
                  disabled={loading}
                />
                <Label
                  htmlFor="include-date"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Include Date
                </Label>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        </Card>

        {/* Output Section */}
        {generatedImage && (
          <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Card className="overflow-hidden shadow-xl">
              <div className="p-6 sm:p-8">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-foreground">Generated Image</h2>
                  <Button onClick={handleDownload} variant="outline" size="sm" className="gap-2">
                    <Download className="size-4" />
                    Download
                  </Button>
                </div>
                <div className="flex justify-center rounded-lg bg-muted/30 p-4">
                  <img
                    src={generatedImage || "/placeholder.svg"}
                    alt="Generated article card"
                    className="max-w-full rounded-md shadow-lg"
                  />
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Features Section */}
        {!generatedImage && (
          <div className="mt-16 grid gap-6 sm:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Link2 className="size-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-foreground">Paste URL</h3>
              <p className="text-sm text-muted-foreground">Simply paste any news article link</p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
                <ImageIcon className="size-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-foreground">Auto Extract</h3>
              <p className="text-sm text-muted-foreground">We grab the image, title, and author</p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Download className="size-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-foreground">Download</h3>
              <p className="text-sm text-muted-foreground">Get your shareable graphic instantly</p>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
