import { GameApp } from './GameApp'

export const instant = false

export default async function Page({ searchParams }: PageProps<'/'>) {
  const { config } = await searchParams
  const configParam = typeof config === 'string' ? config : null
  return <GameApp configParam={configParam} />
}
