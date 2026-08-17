import { visibleAssistantText, wrapCells } from './text'

it('drops complete and in-flight think blocks', () => {
  expect(visibleAssistantText('<think>hidden</think>\nhello')).toBe('hello')
  expect(visibleAssistantText('hello<think>still writing')).toBe('hello')
})

it('wraps by terminal cells so CJK does not overrun', () => {
  expect(wrapCells('思有所溯', 4)).toEqual(['思有', '所溯'])
  expect(wrapCells('ABCDEF', 3)).toEqual(['ABC', 'DEF'])
})
