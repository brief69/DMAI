import { create } from 'ipfs-http-client'
import { Recipe, RecipeMetadata } from '../../core/entities/Recipe'
import { RecipeManager } from '../../core/services/RecipeManager'
import { P2PManager } from '../p2p/libp2p'
import { ChunkManager } from '../../core/services/ChunkManager'

export class RecipeManagerImpl implements RecipeManager {
  private ipfs
  private p2pManager: P2PManager
  private chunkManager: ChunkManager

  constructor(chunkManager: ChunkManager) {
    this.ipfs = create({ url: 'http://localhost:5001/api/v0' })
    this.p2pManager = new P2PManager()
    this.chunkManager = chunkManager
  }

  async init() {
    await this.p2pManager.init()
  }

  async createRecipe(chunks: string[], metadata: RecipeMetadata, creator: string): Promise<Recipe> {
    // レシピデータの作成
    const recipe = new Recipe(
      `recipe-${Date.now()}`,
      chunks,
      metadata,
      creator,
      new Date(),
      new Date(),
      0
    )

    // レシピをIPFSに保存
    const recipeData = Buffer.from(JSON.stringify(recipe))
    const result = await this.ipfs.add(recipeData)
    const updatedRecipe = new Recipe(
      result.cid.toString(),
      recipe.chunks,
      recipe.metadata,
      recipe.creator,
      recipe.createdAt,
      recipe.updatedAt,
      recipe.value
    )

    // P2Pネットワークに新しいレシピを通知
    await this.p2pManager.publish('new-recipe', {
      id: updatedRecipe.id,
      creator: updatedRecipe.creator,
      metadata: updatedRecipe.metadata
    })

    return updatedRecipe
  }

  async getRecipe(id: string): Promise<Recipe> {
    const content = await this.ipfs.cat(id)
    if (!content) throw new Error(`Recipe not found: ${id}`)
    const data = JSON.parse(content.toString())
    return new Recipe(
      data.id,
      data.chunks,
      data.metadata,
      data.creator,
      new Date(data.createdAt),
      new Date(data.updatedAt),
      data.value
    )
  }

  async updateRecipe(id: string, updates: Partial<RecipeMetadata>): Promise<Recipe> {
    const recipe = await this.getRecipe(id)
    const updatedRecipe = recipe.withUpdates({
      metadata: { ...recipe.metadata, ...updates }
    })

    // 更新されたレシピをIPFSに保存
    const recipeData = Buffer.from(JSON.stringify(updatedRecipe))
    const result = await this.ipfs.add(recipeData)
    const finalRecipe = new Recipe(
      result.cid.toString(),
      updatedRecipe.chunks,
      updatedRecipe.metadata,
      updatedRecipe.creator,
      updatedRecipe.createdAt,
      new Date(),
      updatedRecipe.value
    )

    // P2Pネットワークにレシピ更新を通知
    await this.p2pManager.publish('update-recipe', {
      id: finalRecipe.id,
      updates
    })

    return finalRecipe
  }

  async deleteRecipe(id: string): Promise<void> {
    await this.ipfs.pin.rm(id)
    // P2Pネットワークにレシピ削除を通知
    await this.p2pManager.publish('delete-recipe', { id })
  }

  async executeRecipe(recipe: Recipe): Promise<Buffer> {
    // レシピの各チャンクを取得して結合
    const chunks = await Promise.all(
      recipe.chunks.map(cid => this.chunkManager.getChunk(cid))
    )
    
    // TODO: チャンクの結合ロジックを実装
    // この実装は仮のものです
    return Buffer.from('')
  }

  async validateRecipe(recipe: Recipe): Promise<boolean> {
    try {
      // 全てのチャンクの整合性を確認
      const validations = await Promise.all(
        recipe.chunks.map(async cid => {
          try {
            const chunk = await this.chunkManager.getChunk(cid)
            return this.chunkManager.verifyChunkIntegrity(chunk)
          } catch {
            return false
          }
        })
      )
      return validations.every(valid => valid)
    } catch {
      return false
    }
  }

  async calculateZeny(recipe: Recipe): Promise<number> {
    // TODO: ゼニー計算アルゴリズムの実装
    return 0
  }

  async updateRecipeValue(recipe: Recipe, value: number): Promise<void> {
    const currentRecipe = await this.getRecipe(recipe.id)
    const updatedRecipe = currentRecipe.withUpdates({ value })

    // 更新されたレシピをIPFSに保存
    const recipeData = Buffer.from(JSON.stringify(updatedRecipe))
    await this.ipfs.add(recipeData)

    // P2Pネットワークに価値更新を通知
    await this.p2pManager.publish('update-recipe-value', {
      id: recipe.id,
      value
    })
  }

  async stop() {
    await this.p2pManager.stop()
  }
} 