export class ApiError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

export class UsernameTakenError extends Error {
  constructor() {
    super('Username is already registered.')
    this.name = 'UsernameTakenError'
  }
}

export class SessionCollisionError extends Error {
  constructor() {
    super('A session token hash already exists.')
    this.name = 'SessionCollisionError'
  }
}
