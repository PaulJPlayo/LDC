import { Modules } from "@medusajs/utils"
import { CUSTOMER_SAVED_WORKSPACE_MODULE } from "../../../../../../modules/customer-saved-workspace"
import { GET } from "../route"

const createResponse = () => {
  const response: Record<string, unknown> = {
    statusCode: 200,
    body: null,
  }

  response.status = jest.fn((statusCode: number) => {
    response.statusCode = statusCode
    return response
  })

  response.json = jest.fn((body: unknown) => {
    response.body = body
    return response
  })

  return response as any
}

const createRequest = ({
  query = {},
  actorId = "admin_123",
  savedWorkspaceService = {},
  customerService = {},
}: {
  query?: Record<string, unknown>
  actorId?: string | null
  savedWorkspaceService?: Record<string, unknown>
  customerService?: Record<string, unknown>
} = {}) =>
  ({
    auth_context: actorId ? { actor_id: actorId } : {},
    params: { id: "cus_123" },
    query,
    scope: {
      resolve: jest.fn((key: string) => {
        if (key === Modules.CUSTOMER) return customerService
        if (key === CUSTOMER_SAVED_WORKSPACE_MODULE) return savedWorkspaceService
        return null
      }),
    },
  }) as any

const createServices = () => {
  const savedItem = {
    id: "csi_123",
    type: "custom_design",
    title: "Saved custom design",
    source_path: "/customization.html",
    product_id: "prod_123",
    product_handle: "custom-doormat",
    selected_options: [
      { label: "Color", value: "Blue" },
      { label: "Card Number", value: "4111111111111111" },
      { label: "Attachment", value: { file_data: "data:image/png;base64,abc", name: "raw.png" } },
    ],
    notes: "A short customer note.",
    upload_references: [
      {
        filename: "design.png",
        provider: "s3",
        key: "customer-uploads/key.png",
        data_url: "data:image/png;base64,abc",
        token: "tok_secret",
      },
    ],
    item_payload: {
      password: "do-not-return",
    },
    line_item_metadata: {
      payment_token: "tok_do_not_return",
    },
  }

  const savedCart = {
    id: "csc_123",
    name: "Lobby reorder",
    status: "active",
    currency_code: "USD",
    subtotal_snapshot_amount: 12999,
    item_count: 1,
    line_items: [
      {
        title: "Logo mat",
        quantity: 2,
        selected_options: [
          { label: "Size", value: "3x5" },
          { label: "Payment Method", value: "Card" },
        ],
        metadata: {
          design_attachment_name: "logo.png",
          design_attachment_provider: "s3",
          design_attachment_key: "uploads/logo.png",
          payment_token: "tok_cart_do_not_return",
        },
      },
    ],
  }

  return {
    customerService: {
      retrieveCustomer: jest.fn(async () => ({ id: "cus_123" })),
    },
    savedWorkspaceService: {
      listSavedItems: jest.fn(async (_customerId: string, filters: Record<string, unknown> = {}) => {
        if (filters.type === "product_favorite") return [[], 0]
        if (filters.type === "doormat_build") return [[], 0]
        if (filters.type === "attire_build") return [[], 0]
        if (filters.type === "custom_design") return [[savedItem], 1]
        if (filters.type === "seasonal_design") return [[], 0]
        if (filters.type === "note") return [[], 0]
        return [[savedItem], 1]
      }),
      listSavedCarts: jest.fn(async () => [[savedCart], 1]),
      listAndCountCustomerSavedCarts: jest.fn(async () => [[savedCart], 1]),
    },
  }
}

describe("GET /admin/customers/:id/saved-workspace", () => {
  it("returns a read-only sanitized saved workspace response", async () => {
    const services = createServices()
    const req = createRequest({
      query: {
        items_limit: "500",
        carts_limit: "500",
        cart_status: "active",
      },
      ...services,
    })
    const res = createResponse()

    await GET(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      customer_id: "cus_123",
      read_only: true,
      counts: {
        saved_items: 1,
        custom_designs: 1,
        saved_carts: 1,
      },
      saved_items: {
        count: 1,
        limit: 100,
        offset: 0,
      },
      saved_carts: {
        count: 1,
        limit: 50,
        offset: 0,
      },
    })
    expect(services.savedWorkspaceService.listAndCountCustomerSavedCarts).toHaveBeenCalledWith(
      { customer_id: "cus_123", status: "active" },
      expect.objectContaining({ take: 50 })
    )

    const responseText = JSON.stringify(res.body)
    expect(responseText).not.toContain("4111111111111111")
    expect(responseText).not.toContain("data:image")
    expect(responseText).not.toContain("tok_")
    expect(responseText).not.toContain("do-not-return")
    expect(responseText).not.toContain("payment_token")
    expect(responseText).not.toContain("item_payload")
    expect(responseText).not.toContain("line_item_metadata")

    expect((res.body as any).saved_items.data[0].upload_references[0]).toEqual({
      filename: "design.png",
      provider: "s3",
      key_label: "key.png",
      content_type: null,
      size: null,
      status: null,
    })
    expect((res.body as any).saved_carts.data[0].line_items[0].upload_references[0]).toEqual({
      filename: "logo.png",
      provider: "s3",
      key_label: "logo.png",
      content_type: null,
      size: null,
      status: null,
    })
  })

  it("returns 400 for invalid query values", async () => {
    const services = createServices()
    const req = createRequest({
      query: { items_offset: "-1" },
      ...services,
    })
    const res = createResponse()

    await GET(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.body).toEqual({ message: "Pagination offset must be a non-negative number." })
  })

  it("returns 401 without an admin auth actor", async () => {
    const services = createServices()
    const req = createRequest({
      actorId: null,
      ...services,
    })
    const res = createResponse()

    await GET(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.body).toEqual({ message: "Authentication required." })
    expect(services.savedWorkspaceService.listSavedItems).not.toHaveBeenCalled()
  })
})
