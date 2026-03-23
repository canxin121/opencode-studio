import assert from 'node:assert/strict'
import test from 'node:test'

import { getDeviceInfo } from '../src/lib/device'

type DeviceEnv = {
  isNarrowLayout: boolean
  isNarrowTouch: boolean
  isCoarsePointer: boolean
  desktopContainer?: boolean
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
  userAgentDataMobile?: boolean | null
}

function withMockedDeviceEnv(env: DeviceEnv, run: () => void) {
  const globalObj = globalThis as typeof globalThis & {
    window?: { matchMedia?: (query: string) => { matches: boolean } }
    navigator?: {
      userAgent?: string
      platform?: string
      maxTouchPoints?: number
      userAgentData?: { mobile?: boolean }
    }
  }

  const originalWindow = globalObj.window
  const originalNavigator = globalObj.navigator

  const matchMedia = (query: string) => {
    if (query === '(max-width: 900px)') return { matches: env.isNarrowLayout }
    if (query === '(max-width: 1024px)') return { matches: env.isNarrowTouch }
    if (query === '(pointer: coarse)') return { matches: env.isCoarsePointer }
    return { matches: false }
  }

  const nextNavigator: {
    userAgent: string
    platform: string
    maxTouchPoints: number
    userAgentData?: { mobile?: boolean }
  } = {
    userAgent: env.userAgent || '',
    platform: env.platform || '',
    maxTouchPoints: env.maxTouchPoints || 0,
  }

  if (typeof env.userAgentDataMobile === 'boolean') {
    nextNavigator.userAgentData = { mobile: env.userAgentDataMobile }
  }

  const nextWindow: {
    matchMedia: (query: string) => { matches: boolean }
    __TAURI_INTERNALS__?: { invoke: () => null }
  } = {
    matchMedia,
  }

  if (env.desktopContainer) {
    nextWindow.__TAURI_INTERNALS__ = {
      invoke: () => null,
    }
  }

  Object.defineProperty(globalObj, 'window', {
    configurable: true,
    value: nextWindow,
  })

  Object.defineProperty(globalObj, 'navigator', {
    configurable: true,
    value: nextNavigator,
  })

  try {
    run()
  } finally {
    if (typeof originalWindow === 'undefined') {
      Reflect.deleteProperty(globalObj, 'window')
    } else {
      Object.defineProperty(globalObj, 'window', {
        configurable: true,
        value: originalWindow,
      })
    }

    if (typeof originalNavigator === 'undefined') {
      Reflect.deleteProperty(globalObj, 'navigator')
    } else {
      Object.defineProperty(globalObj, 'navigator', {
        configurable: true,
        value: originalNavigator,
      })
    }
  }
}

test('treats compact desktop viewport as compact layout, not mobile device', () => {
  withMockedDeviceEnv(
    {
      isNarrowLayout: true,
      isNarrowTouch: true,
      isCoarsePointer: false,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/136.0 Safari/537.36',
      platform: 'Linux x86_64',
      maxTouchPoints: 0,
      userAgentDataMobile: false,
    },
    () => {
      const info = getDeviceInfo()
      assert.equal(info.isMobile, true)
      assert.equal(info.isMobilePointer, false)
      assert.equal(info.isNarrow, true)
      assert.equal(info.isCompactLayout, true)
      assert.equal(info.isCoarsePointer, false)
      assert.equal(info.isTouchPointer, false)
      assert.equal(info.isMobileDevice, false)
    },
  )
})

test('classifies narrow coarse-pointer viewport as mobile', () => {
  withMockedDeviceEnv(
    {
      isNarrowLayout: true,
      isNarrowTouch: true,
      isCoarsePointer: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/136.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
      userAgentDataMobile: true,
    },
    () => {
      const info = getDeviceInfo()
      assert.equal(info.isMobile, true)
      assert.equal(info.isMobilePointer, true)
      assert.equal(info.isNarrow, true)
      assert.equal(info.isCompactLayout, true)
      assert.equal(info.isCoarsePointer, true)
      assert.equal(info.isTouchPointer, true)
      assert.equal(info.isMobileDevice, true)
    },
  )
})

test('uses mobile user-agent fallback when pointer is not coarse', () => {
  withMockedDeviceEnv(
    {
      isNarrowLayout: true,
      isNarrowTouch: true,
      isCoarsePointer: false,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      platform: 'iPhone',
      maxTouchPoints: 5,
      userAgentDataMobile: null,
    },
    () => {
      const info = getDeviceInfo()
      assert.equal(info.isMobile, true)
      assert.equal(info.isMobilePointer, false)
      assert.equal(info.isNarrow, true)
      assert.equal(info.isCompactLayout, true)
      assert.equal(info.isCoarsePointer, false)
      assert.equal(info.isTouchPointer, false)
      assert.equal(info.isMobileDevice, true)
    },
  )
})

test('desktop container runtime is never treated as mobile device', () => {
  withMockedDeviceEnv(
    {
      isNarrowLayout: true,
      isNarrowTouch: true,
      isCoarsePointer: true,
      desktopContainer: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      platform: 'iPhone',
      maxTouchPoints: 5,
      userAgentDataMobile: true,
    },
    () => {
      const info = getDeviceInfo()
      assert.equal(info.isCompactLayout, true)
      assert.equal(info.isMobile, true)
      assert.equal(info.isTouchPointer, true)
      assert.equal(info.isMobilePointer, true)
      assert.equal(info.isMobileDevice, false)
    },
  )
})
