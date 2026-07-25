import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { router } from './router.tsx'
import './styles.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('#root が見つかりません')

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
