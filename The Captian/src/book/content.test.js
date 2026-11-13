import { describe, expect, it } from 'vitest'
import { menuContent } from './content.js'
import { splitPages } from './textures.js'

const dish = (i, extra = {}) => ({ name: `Dish ${i}`, price: 100 + i, ...extra })

describe('menuContent', () => {
  it('makes a contents page, then a page per section with rupee prices', () => {
    const { content, pages, pageOf } = menuContent([
      { title: 'Tiffin', note: 'With chutney', items: [dish(1), dish(2, { soldOut: true })] },
      { title: 'Desserts', items: [dish(3)] },
    ])
    const chunks = splitPages(content)
    expect(chunks).toHaveLength(3)
    // page 1 is the title page, page 2 the contents
    expect(pageOf).toEqual({ Tiffin: 3, Desserts: 4 })
    expect(chunks[0]).toContain('Tiffin | 3')
    expect(chunks[1]).toBe('# Tiffin\n> With chutney\n\nDish 1 | ₹101\nDish 2 | Sold out')
    expect(pages % 2).toBe(0)
    expect(pages).toBeGreaterThanOrEqual(1 + chunks.length)
  })

  it('carries a long section over to more pages', () => {
    const items = Array.from({ length: 20 }, (_, i) => dish(i))
    const { content, pageOf } = menuContent([{ title: 'Dosa', items }, { title: 'Rice', items: [dish(99)] }])
    const chunks = splitPages(content)
    expect(chunks[2]).toMatch(/^# Dosa \(contd\.\)/)
    expect(chunks[1].split('\n').filter((l) => l.includes('|'))).toHaveLength(14)
    expect(pageOf.Rice).toBe(5)
  })
})
