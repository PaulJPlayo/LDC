import { MedusaService } from "@medusajs/framework/utils"
import CustomerSavedCart from "./models/customer-saved-cart"
import CustomerSavedItem from "./models/customer-saved-item"
import CustomerSavedUploadReference from "./models/customer-saved-upload-reference"
import {
  normalizeSavedCartInput,
  normalizeSavedItemInput,
  SavedCartInput,
  SavedItemInput,
  validateMergeItems,
} from "./validation"

type ListSavedItemsFilters = {
  type?: string
  limit?: number
  offset?: number
}

type ListSavedCartsFilters = {
  limit?: number
  offset?: number
}

type MergeSavedItemsResult = {
  saved_items: unknown[]
  merged: number
  skipped: number
  errors: Array<{ index: number; message: string }>
}

class CustomerSavedWorkspaceModuleService extends MedusaService({
  CustomerSavedItem,
  CustomerSavedCart,
  CustomerSavedUploadReference,
}) {
  async listSavedItems(customerId: string, filters: ListSavedItemsFilters = {}) {
    const query: Record<string, unknown> = {
      customer_id: customerId,
    }

    if (filters.type) {
      query.type = filters.type
    }

    return await (this as any).listAndCountCustomerSavedItems(query, {
      skip: filters.offset || 0,
      take: filters.limit || 50,
      order: { updated_at: "DESC" },
    })
  }

  async upsertSavedItem(customerId: string, input: unknown) {
    const normalized = normalizeSavedItemInput(input)
    const existing = await this.findActiveSavedItem(customerId, normalized.dedupe_key)
    const payload = this.buildSavedItemPayload(customerId, normalized)

    if (!existing) {
      return await (this as any).createCustomerSavedItems(payload)
    }

    const hasNotes = this.hasOwn(input, "notes")
    const hasUploadReferences = this.hasOwn(input, "upload_references")
    const updatePayload = {
      id: existing.id,
      ...payload,
      customer_id: customerId,
    }

    if (!hasNotes) {
      delete (updatePayload as Record<string, unknown>).notes
    }

    if (!hasUploadReferences) {
      delete (updatePayload as Record<string, unknown>).upload_references
    }

    const updated = await (this as any).updateCustomerSavedItems(updatePayload)
    return Array.isArray(updated) ? updated[0] : updated
  }

  async softDeleteSavedItem(customerId: string, id: string) {
    const [item] = await (this as any).listCustomerSavedItems(
      {
        id,
        customer_id: customerId,
      },
      { take: 1 }
    )

    if (!item) {
      return false
    }

    await (this as any).softDeleteCustomerSavedItems(id)
    return true
  }

  async mergeSavedItems(customerId: string, items: unknown): Promise<MergeSavedItemsResult> {
    const mergeItems = validateMergeItems(items)
    const result: MergeSavedItemsResult = {
      saved_items: [],
      merged: 0,
      skipped: 0,
      errors: [],
    }

    for (let index = 0; index < mergeItems.length; index += 1) {
      try {
        const savedItem = await this.upsertSavedItem(customerId, mergeItems[index])
        result.saved_items.push(savedItem)
        result.merged += 1
      } catch (error) {
        result.skipped += 1
        result.errors.push({
          index,
          message: error instanceof Error ? error.message : "Saved item could not be merged.",
        })
      }
    }

    return result
  }

  async listSavedCarts(customerId: string, filters: ListSavedCartsFilters = {}) {
    return await (this as any).listAndCountCustomerSavedCarts(
      {
        customer_id: customerId,
      },
      {
        skip: filters.offset || 0,
        take: filters.limit || 50,
        order: { updated_at: "DESC" },
      }
    )
  }

  async createSavedCart(customerId: string, input: unknown) {
    const normalized = normalizeSavedCartInput(input)
    return await (this as any).createCustomerSavedCarts(
      this.buildSavedCartPayload(customerId, normalized)
    )
  }

  async softDeleteSavedCart(customerId: string, id: string) {
    const [cart] = await (this as any).listCustomerSavedCarts(
      {
        id,
        customer_id: customerId,
      },
      { take: 1 }
    )

    if (!cart) {
      return false
    }

    await (this as any).softDeleteCustomerSavedCarts(id)
    return true
  }

  private async findActiveSavedItem(customerId: string, dedupeKey: string) {
    const [item] = await (this as any).listCustomerSavedItems(
      {
        customer_id: customerId,
        dedupe_key: dedupeKey,
      },
      {
        take: 1,
        order: { updated_at: "DESC" },
      }
    )

    return item || null
  }

  private buildSavedItemPayload(customerId: string, input: SavedItemInput) {
    return {
      ...input,
      customer_id: customerId,
      selected_options: input.selected_options || [],
      item_payload: input.item_payload || {},
      upload_references: input.upload_references || [],
      quantity: input.quantity || 1,
      currency_code: input.currency_code || "USD",
    }
  }

  private buildSavedCartPayload(customerId: string, input: SavedCartInput) {
    return {
      ...input,
      customer_id: customerId,
      status: input.status || "active",
      line_items: input.line_items || [],
      cart_snapshot: input.cart_snapshot || {},
      item_count: input.item_count || 0,
      currency_code: input.currency_code || "USD",
    }
  }

  private hasOwn(value: unknown, key: string) {
    return !!value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key)
  }
}

export default CustomerSavedWorkspaceModuleService
