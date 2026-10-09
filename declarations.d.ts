declare module "expo-local-authentication" {
  export enum SecurityLevel {
    NONE = 0,
    SECRET = 1,
    BIOMETRIC = 2,
    BIOMETRIC_WEAK = 2,
    BIOMETRIC_STRONG = 3,
  }
  export enum AuthenticationType {
    FINGERPRINT = 1,
    FACIAL_RECOGNITION = 2,
    IRIS = 3,
  }
  export function hasHardwareAsync(): Promise<boolean>;
  export function isEnrolledAsync(): Promise<boolean>;
  export function getEnrolledLevelAsync(): Promise<SecurityLevel>;
  export function supportedAuthenticationTypesAsync(): Promise<AuthenticationType[]>;
  export function authenticateAsync(options?: any): Promise<{ success: boolean; error?: string }>;
}

declare module "expo-secure-store" {
  export function getItemAsync(key: string, options?: any): Promise<string | null>;
  export function setItemAsync(key: string, value: string, options?: any): Promise<void>;
  export function deleteItemAsync(key: string, options?: any): Promise<void>;
}
