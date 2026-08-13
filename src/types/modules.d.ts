declare module "amqplib" {
  import amqp from "amqplib/channel_api"
  export * from "amqplib/channel_api"
  export default amqp
}

declare module "nodemailer" {
  import nodemailer from "nodemailer/lib/nodemailer"
  export * from "nodemailer/lib/nodemailer"
  export default nodemailer
}

declare module "web-push" {
  interface PushSubscription {
    endpoint: string
    keys: { p256dh: string; auth: string }
  }

  interface PushOptions {
    vapidDetails?: {
      subject: string
      publicKey: string
      privateKey: string
    }
    TTL?: number
    headers?: Record<string, string>
    contentEncoding?: string
  }

  interface SendResult {
    statusCode: number
    body: string
    headers: Record<string, string>
  }

  function sendNotification(
    subscription: PushSubscription,
    payload: string | Buffer,
    options?: PushOptions,
  ): Promise<SendResult>

  function setVapidDetails(subject: string, publicKey: string, privateKey: string): void

  function generateVAPIDKeys(): {
    publicKey: string
    privateKey: string
  }

  export {
    sendNotification,
    setVapidDetails,
    generateVAPIDKeys,
    PushSubscription,
    PushOptions,
    SendResult,
  }
}
