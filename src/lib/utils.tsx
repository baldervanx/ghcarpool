import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { createContext, useContext, useEffect, useState, useMemo } from 'react'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

type TextSize = 'normal' | 'large' | 'larger'

type AccessibilitySettings = {
  isHighContrast: boolean
  textSize: TextSize
}

const DEFAULT_SETTINGS: AccessibilitySettings = {
  isHighContrast: false,
  textSize: 'normal'
}

type AccessibilityContextType = {
  settings: AccessibilitySettings
  updateSettings: (newSettings: Partial<AccessibilitySettings>) => void
}

const AccessibilityContext = createContext<AccessibilityContextType>({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {}
})

export const useAccessibility = () => {
  const context = useContext(AccessibilityContext)
  if (!context) {
    throw new Error('useAccessibility must be used within an AccessibilityProvider')
  }
  return context
}

const getStoredSettings = (): AccessibilitySettings => {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS

  try {
    const stored = localStorage.getItem('accessibilitySettings')
    if (!stored) return DEFAULT_SETTINGS

    const parsed = JSON.parse(stored) as Partial<AccessibilitySettings>

    return {
      isHighContrast: typeof parsed.isHighContrast === 'boolean' ? parsed.isHighContrast : DEFAULT_SETTINGS.isHighContrast,
      textSize: parsed.textSize && ['normal', 'large', 'larger'].includes(parsed.textSize)
        ? parsed.textSize
        : DEFAULT_SETTINGS.textSize
    }
  } catch (error) {
    console.error('Failed to parse accessibility settings:', error)
    return DEFAULT_SETTINGS
  }
}

export const AccessibilityProvider = ({ children }: { children: React.ReactNode }) => {
  const [settings, setSettings] = useState<AccessibilitySettings>(getStoredSettings)

  const updateSettings = (newSettings: Partial<AccessibilitySettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }))
  }

  useEffect(() => {
    try {
      localStorage.setItem('accessibilitySettings', JSON.stringify(settings))
    } catch (error) {
      console.error('Failed to save accessibility settings:', error)
    }
  }, [settings])

  return (
    <AccessibilityContext.Provider value={{ settings, updateSettings }}>
      {children}
    </AccessibilityContext.Provider>
  )
}

// Mappning av text-storlekar
const textSizeMap = {
  normal: {
  },
  large: {
    'text-xs': 'text-sm',
    'text-sm': 'text-base',
    'text-base': 'text-lg',
    'text-lg': 'text-xl',
    'text-xl': 'text-2xl',
    'text-2xl': 'text-3xl',
    'text-3xl': 'text-4xl',
  },
  larger: {
    'text-xs': 'text-base',
    'text-sm': 'text-lg',
    'text-base': 'text-xl',
    'text-lg': 'text-2xl',
    'text-xl': 'text-3xl',
    'text-2xl': 'text-4xl',
    'text-3xl': 'text-5xl',
  },
} as const

// Mappning för högkontrast
const highContrastMap = {
  'text-gray-300': 'text-gray-600',
  'text-gray-400': 'text-gray-700',
  'text-gray-500': 'text-gray-800',
  'text-gray-600': 'text-gray-900',
  'opacity-50': 'opacity-75',
  'opacity-40': 'opacity-60',
  'opacity-30': 'opacity-50',
  'disabled:opacity-50': 'disabled:opacity-75',
} as const

export function useAccessibleCn() {
  const { settings } = useAccessibility()

  return useMemo(() => {
    return function (...inputs: ClassValue[]) {
      let classes = clsx(inputs).split(' ')

      if (!classes.includes('no-a11y')) {
        // Hantera textstorlekar
        if (settings.textSize !== 'normal') {
          const sizeMap = textSizeMap[settings.textSize]
          classes = classes.map(cls => sizeMap[cls as keyof typeof sizeMap] || cls)
        }

        // Hantera högkontrast
        if (settings.isHighContrast) {
          classes = classes.map(cls => highContrastMap[cls as keyof typeof highContrastMap] || cls)
        }
      }

      return twMerge(classes)
    }
  }, [settings.isHighContrast, settings.textSize])
}

export const isOnline = () => {
  return window.navigator.onLine;
};
