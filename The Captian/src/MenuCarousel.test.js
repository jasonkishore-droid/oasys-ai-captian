import { describe, expect, it } from 'vitest'
import { findSection } from './MenuCarousel.jsx'

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
