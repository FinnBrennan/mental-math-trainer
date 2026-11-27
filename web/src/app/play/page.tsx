import { GameApp } from '../GameApp'

export const instant = false

export default async function Page({ searchParams }: { searchParams: Promise<{ config?: string }> }) {
  const { config } = await searchParams
  const configParam = typeof config === 'string' ? config : null
  return <GameApp configParam={configParam} />
}
