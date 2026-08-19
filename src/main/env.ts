import { app } from 'electron'

// app.isPackaged, not Vite's import.meta.env — conveyor runs unbundled in main (import.meta.env is
// undefined there when consumed as an external package); app.isPackaged is accurate either way.
export const isDev = !app.isPackaged
