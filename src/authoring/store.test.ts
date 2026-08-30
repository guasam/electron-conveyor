import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineStore } from './store'

const counter = defineStore('counter', {
  state: { count: 0, updatedBy: 'init' as string },
  schemas: { increment: z.number().optional() },
  actions: {
    // `by` is typed from the schema (number | undefined) — schema-first, no annotation needed.
    increment: (s, by = 1) => {
      s.count += by
      s.updatedBy = 'increment'
    },
    reset: (s) => {
      s.count = 0
      s.updatedBy = 'reset'
    },
  },
  persist: true,
})

describe('defineStore', () => {
  it('captures id, initial state, actions, schemas, and persist', () => {
    expect(counter.id).toBe('counter')
    expect(counter.initialState).toEqual({ count: 0, updatedBy: 'init' })
    expect(Object.keys(counter.actions)).toEqual(['increment', 'reset'])
    expect(counter.schemas?.increment).toBeDefined()
    expect(counter.persist).toBe(true)
  })

  it('reducers mutate the draft (pure, deterministic)', () => {
    const state = structuredClone(counter.initialState)
    counter.actions.increment(state, 5)
    expect(state).toEqual({ count: 5, updatedBy: 'increment' })
    counter.actions.reset(state)
    expect(state).toEqual({ count: 0, updatedBy: 'reset' })
  })

  it('does not mutate the definition initialState', () => {
    const state = structuredClone(counter.initialState)
    counter.actions.increment(state, 3)
    expect(counter.initialState.count).toBe(0)
  })

  it('schemas validate the payload the way main will', () => {
    const schema = counter.schemas!.increment!
    expect(schema['~standard'].validate(5)).toMatchObject({ value: 5 })
    expect(schema['~standard'].validate('nope')).toHaveProperty('issues')
  })
})
