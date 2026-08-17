import { clipVisible, getTheme, padVisible, stripAnsi, visibleWidth } from './theme'

it('pads and clips by visible width, not ANSI bytes', () => {
  const theme = getTheme('dark')
  const painted = theme.accent('SISU')
  expect(visibleWidth(painted)).toBe(4)
  expect(visibleWidth(painted)).toBeLessThan(painted.length)
  expect(stripAnsi(padVisible(painted, 8))).toBe('SISU    ')
  expect(stripAnsi(clipVisible(painted, 2))).toBe('SI')
})

it('dark and light palettes disagree on body text', () => {
  expect(getTheme('dark').text('x')).not.toBe(getTheme('light').text('x'))
})
