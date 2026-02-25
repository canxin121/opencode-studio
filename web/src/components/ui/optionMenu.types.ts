import type { Component } from 'vue'

export type OptionMenuItem = {
  id: string
  label: string
  description?: string
  icon?: Component
  disabled?: boolean
  checked?: boolean
  variant?: 'default' | 'destructive'
  keywords?: string
  monospace?: boolean
  confirmTitle?: string
  confirmDescription?: string
  confirmText?: string
  cancelText?: string
}

export type OptionMenuGroup = {
  id?: string
  title?: string
  subtitle?: string
  items: OptionMenuItem[]
  collapsible?: boolean
  defaultCollapsed?: boolean
}
