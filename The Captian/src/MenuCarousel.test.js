import { describe, expect, it } from 'vitest'
import { changeTray, findSection, MAX_PER_DISH, trayTotals, noteTray } from './MenuCarousel.jsx'

describe('the order tray', () => {
  const idli = { id: 1, name: 'Idli (2 pcs)', price: 50 }
  const vada = { id: 2, name: 'Medu Vada (2 pcs)', price: 60 }

  it('adds, counts up and keeps the order dishes were tapped in', () => {
    let t = changeTray([], idli, 1)
    t = changeTray(t, vada, 1)
    t = changeTray(t, idli, 1)
    expect(t.map((x) => [x.name, x.quantity])).toEqual([['Idli (2 pcs)', 2], ['Medu Vada (2 pcs)', 1]])
    expect(trayTotals(t)).toEqual({ count: 3, total: 160 })
  })

  it('removes a dish when its count reaches zero, and ignores minus on a dish not in it', () => {
    let t = changeTray([], idli, 1)
    t = changeTray(t, idli, -1)
    expect(t).toEqual([])
    expect(changeTray([], vada, -1)).toEqual([])
  })

  it('never goes over what one order can take of a dish', () => {
    let t = []
    for (let i = 0; i < MAX_PER_DISH + 5; i++) t = changeTray(t, idli, 1)
    expect(t[0].quantity).toBe(MAX_PER_DISH)
  })
})

const sections = ['Breakfast & Tiffin', 'Dosa Varieties', 'Vegetarian Starters', 'Chicken Starters', 'Biryani & Rice', 'Desserts', 'Beverages'].map((title) => ({ title }))
const at = (w) => sections[findSection(sections, w)]?.title

describe('findSection', () => {
  it('finds a section from what the guest said', () => {
    expect(at('desserts')).toBe('Desserts')
    expect(at('dessert')).toBe('Desserts')
    expect(at('dosa')).toBe('Dosa Varieties')
    expect(at('chicken starters')).toBe('Chicken Starters')
    expect(at('biryani')).toBe('Biryani & Rice')
    expect(at('Beverages')).toBe('Beverages')
  })
  it('says when nothing matches', () => {
    expect(findSection(sections, 'pizza')).toBe(-1)
    expect(findSection(sections, '')).toBe(-1)
  })
})

describe('noteTray', () => {
  const dosa = { id: 1, name: 'Masala Dosa', price: 90 }
  const coffee = { id: 2, name: 'Filter Coffee', price: 30 }
  it('sets, keeps and removes a dish\'s special request', () => {
    let t = changeTray(changeTray([], dosa, 1), coffee, 1)
    t = noteTray(t, 1, '  less   oil ')
    expect(t[0].note).toBe('less oil')
    expect(t[1].note).toBeUndefined()
    // more of the dish keeps its request
    t = changeTray(t, dosa, 1)
    expect(t[0]).toMatchObject({ quantity: 2, note: 'less oil' })
    expect(noteTray(t, 1, 'x'.repeat(150))[0].note).toHaveLength(100)
    expect(noteTray(t, 1, '   ')[0].note).toBeUndefined()
  })
})
