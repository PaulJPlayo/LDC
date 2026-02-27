import {
  AbstractPaymentProvider,
  MathBN,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils";
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
} from "@medusajs/types";
import type { Logger } from "@medusajs/framework/types";

type PayPalOptions = {
  clientId: string;
  clientSecret: string;
  mode?: "sandbox" | "live";
  brandName?: string;
};

type PayPalToken = {
  accessToken: string;
  expiresAt: number;
};

type PayPalLink = {
  href: string;
  rel: string;
  method?: string;
};

type PayPalOrder = {
  id: string;
  status: string;
  links?: PayPalLink[];
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{
        id: string;
        status: string;
      }>;
      authorizations?: Array<{
        id: string;
        status: string;
      }>;
    };
  }>;
  payer?: {
    payer_id?: string;
  };
};

const PAYPAL_BASE_URL = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY",
  "KRW",
  "VND",
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  "BHD",
  "JOD",
  "KWD",
  "OMR",
  "TND",
]);

class PayPalProviderService extends AbstractPaymentProvider<PayPalOptions> {
  static identifier = "paypal";

  protected logger_: Logger | undefined;
  protected options_: PayPalOptions;
  protected baseUrl_: string;
  protected token_: PayPalToken | null = null;

  static validateOptions(options: Record<string, unknown>) {
    if (!options?.clientId || !options?.clientSecret) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayPal clientId and clientSecret are required."
      );
    }
  }

  constructor(container: { logger?: Logger }, options: PayPalOptions) {
    super(container, options);
    this.logger_ = container.logger;
    this.options_ = options;
    this.baseUrl_ =
      options.mode === "live" ? PAYPAL_BASE_URL.live : PAYPAL_BASE_URL.sandbox;
  }

  private getMinorUnits(currencyCode: string) {
    const code = (currencyCode || "USD").toUpperCase();
    if (ZERO_DECIMAL_CURRENCIES.has(code)) {
      return 0;
    }
    if (THREE_DECIMAL_CURRENCIES.has(code)) {
      return 3;
    }
    return 2;
  }

  private formatAmount(amount: number, currencyCode: string) {
    const decimals = this.getMinorUnits(currencyCode);
    return Number(amount).toFixed(decimals);
  }

  private formatAmountFromMinor(amountMinor: number, currencyCode: string) {
    const decimals = this.getMinorUnits(currencyCode);
    const divisor = 10 ** decimals;
    const amountMajor = Number(amountMinor) / divisor;
    return this.formatAmount(amountMajor, currencyCode);
  }

  private async getAccessToken() {
    const now = Date.now();
    if (this.token_ && this.token_.expiresAt > now) {
      return this.token_.accessToken;
    }

    const auth = Buffer.from(
      `${this.options_.clientId}:${this.options_.clientSecret}`
    ).toString("base64");

    const response = await fetch(`${this.baseUrl_}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`PayPal auth failed: ${text || response.statusText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    const expiresIn = Math.max(0, Number(data.expires_in) - 60);
    this.token_ = {
      accessToken: data.access_token,
      expiresAt: now + expiresIn * 1000,
    };

    return data.access_token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string
  ) {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.baseUrl_}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "PayPal-Request-Id": idempotencyKey } : {}),
        Prefer: "return=representation",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `PayPal request failed (${response.status}): ${text || response.statusText}`
      );
    }

    return (await response.json()) as T;
  }

  private buildOrderPayload(input: InitiatePaymentInput) {
    const currency = (input.currency_code || "USD").toUpperCase();
    const amountValue = this.formatAmountFromMinor(Number(input.amount), currency);
    const returnUrl = String(input.data?.return_url || "");
    const cancelUrl = String(input.data?.cancel_url || returnUrl);

    if (!returnUrl) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayPal return_url is required to initiate a payment."
      );
    }

    const address = input.data?.shipping_address as Record<string, unknown> | undefined;
    const hasAddress =
      !!address?.address_1 &&
      !!address?.city &&
      !!address?.country_code &&
      !!address?.postal_code;

    const fullName = `${address?.first_name || ""} ${address?.last_name || ""}`.trim();
    const shipping =
      hasAddress
        ? {
            name: fullName ? { full_name: fullName } : undefined,
            address: {
              address_line_1: String(address?.address_1 || ""),
              address_line_2: String(address?.address_2 || ""),
              admin_area_2: String(address?.city || ""),
              admin_area_1: String(address?.province || ""),
              postal_code: String(address?.postal_code || ""),
              country_code: String(address?.country_code || "").toUpperCase(),
            },
          }
        : undefined;

    const applicationContext: Record<string, unknown> = {
      return_url: returnUrl,
      cancel_url: cancelUrl,
      brand_name: this.options_.brandName || "Lovett's Designs & Crafts",
      user_action: "PAY_NOW",
      shipping_preference: shipping ? "SET_PROVIDED_ADDRESS" : "GET_FROM_FILE",
    };

    const email = input.data?.email as string | undefined;

    const payload: Record<string, unknown> = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: currency,
            value: amountValue,
          },
          ...(shipping ? { shipping } : {}),
        },
      ],
      application_context: applicationContext,
    };

    if (email) {
      payload.payer = { email_address: email };
    }

    return payload;
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const payload = this.buildOrderPayload(input);
    const order = await this.request<PayPalOrder>(
      "POST",
      "/v2/checkout/orders",
      payload,
      input.context?.idempotency_key
    );

    const approvalLink = order.links?.find((link) => link.rel === "approve");

    return {
      id: order.id,
      data: {
        order_id: order.id,
        status: order.status,
        redirect_url: approvalLink?.href || "",
      },
      status: PaymentSessionStatus.PENDING,
    };
  }

  async updatePayment(
    input: UpdatePaymentInput
  ): Promise<UpdatePaymentOutput> {
    const order = await this.initiatePayment({
      ...input,
      amount: input.amount,
      currency_code: input.currency_code,
    } as InitiatePaymentInput);

    return {
      data: {
        ...input.data,
        ...order.data,
      },
      status: order.status,
    };
  }

  async deletePayment(
    input: DeletePaymentInput
  ): Promise<DeletePaymentOutput> {
    return { data: input.data || {} };
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const orderId = input.data?.order_id as string | undefined;
    if (!orderId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayPal order_id is missing."
      );
    }

    const order = await this.request<PayPalOrder>(
      "GET",
      `/v2/checkout/orders/${orderId}`
    );

    if (order.status === "APPROVED") {
      const capture = await this.request<PayPalOrder>(
        "POST",
        `/v2/checkout/orders/${orderId}/capture`,
        {},
        input.context?.idempotency_key
      );
      const captureId =
        capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || "";

      return {
        status: PaymentSessionStatus.CAPTURED,
        data: {
          order_id: orderId,
          capture_id: captureId,
          payer_id: capture.payer?.payer_id,
          status: capture.status,
        },
      };
    }

    if (order.status === "COMPLETED") {
      const captureId =
        order.purchase_units?.[0]?.payments?.captures?.[0]?.id || "";
      return {
        status: PaymentSessionStatus.CAPTURED,
        data: {
          order_id: orderId,
          capture_id: captureId,
          payer_id: order.payer?.payer_id,
          status: order.status,
        },
      };
    }

    if (order.status === "VOIDED") {
      return {
        status: PaymentSessionStatus.CANCELED,
        data: {
          order_id: orderId,
          status: order.status,
        },
      };
    }

    return {
      status: PaymentSessionStatus.REQUIRES_MORE,
      data: {
        order_id: orderId,
        status: order.status,
      },
    };
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const captureId = input.data?.capture_id as string | undefined;
    const orderId = input.data?.order_id as string | undefined;

    if (captureId) {
      return { data: input.data || {} };
    }

    if (!orderId) {
      return { data: input.data || {} };
    }

    const capture = await this.request<PayPalOrder>(
      "POST",
      `/v2/checkout/orders/${orderId}/capture`,
      {},
      input.context?.idempotency_key
    );
    const newCaptureId =
      capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || "";

    return {
      data: {
        ...input.data,
        order_id: orderId,
        capture_id: newCaptureId,
        status: capture.status,
      },
    };
  }

  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    const captureId = input.data?.capture_id as string | undefined;
    if (!captureId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayPal capture_id is required to refund."
      );
    }
    const currency = String(input.data?.currency_code || "USD").toUpperCase();
    const refundAmount = this.formatAmountFromMinor(Number(input.amount), currency);
    const refund = await this.request<{ id: string; status: string }>(
      "POST",
      `/v2/payments/captures/${captureId}/refund`,
      {
        amount: {
          currency_code: currency,
          value: refundAmount,
        },
      },
      input.context?.idempotency_key
    );
    return {
      data: {
        ...input.data,
        refund_id: refund.id,
        refund_status: refund.status,
      },
    };
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const orderId = input.data?.order_id as string | undefined;
    if (!orderId) {
      return { data: input.data || {} };
    }
    const order = await this.request<PayPalOrder>(
      "GET",
      `/v2/checkout/orders/${orderId}`
    );
    return { data: order as unknown as Record<string, unknown> };
  }

  async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    return { data: input.data || {} };
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const orderId = input.data?.order_id as string | undefined;
    if (!orderId) {
      return {
        status: PaymentSessionStatus.PENDING,
        data: input.data,
      };
    }
    const order = await this.request<PayPalOrder>(
      "GET",
      `/v2/checkout/orders/${orderId}`
    );
    switch (order.status) {
      case "COMPLETED":
        return {
          status: PaymentSessionStatus.CAPTURED,
          data: input.data,
        };
      case "APPROVED":
        return {
          status: PaymentSessionStatus.AUTHORIZED,
          data: input.data,
        };
      case "VOIDED":
        return {
          status: PaymentSessionStatus.CANCELED,
          data: input.data,
        };
      case "CREATED":
      default:
        return {
          status: PaymentSessionStatus.PENDING,
          data: input.data,
        };
    }
  }

  async getWebhookActionAndData() {
    return {
      action: PaymentActions.NOT_SUPPORTED,
    };
  }
}

export default PayPalProviderService;
