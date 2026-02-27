import PayPalProviderService from "../paypal"

describe("PayPal amount conversion", () => {
  const service = new PayPalProviderService(
    {} as any,
    {
      clientId: "x",
      clientSecret: "y",
      mode: "sandbox",
    } as any
  )

  const buildPayload = (amount: number, currency_code: string) =>
    (service as any).buildOrderPayload({
      amount,
      currency_code,
      data: {
        return_url: "https://example.com/return",
        cancel_url: "https://example.com/cancel",
      },
    })

  it("converts USD minor units to major units", () => {
    const payload = buildPayload(1003, "USD")
    expect(payload.purchase_units[0].amount.value).toBe("10.03")
  })

  it("converts JPY minor units to major units with zero decimals", () => {
    const payload = buildPayload(1003, "JPY")
    expect(payload.purchase_units[0].amount.value).toBe("1003")
  })

  it("converts KWD minor units to major units with three decimals", () => {
    const payload = buildPayload(1003, "KWD")
    expect(payload.purchase_units[0].amount.value).toBe("1.003")
  })

  it("requires return_url", () => {
    expect(() =>
      (service as any).buildOrderPayload({
        amount: 1003,
        currency_code: "USD",
        data: {},
      })
    ).toThrow("PayPal return_url is required to initiate a payment.")
  })
})
