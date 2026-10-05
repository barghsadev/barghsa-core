export type LoginStage = 'credentials' | 'change' | 'otp';
export type LoginValues = {
  username: string;
  password: string;
  newPassword: string;
  confirmation: string;
  otp: string;
  trustDevice: boolean;
};
export const emptyLogin: LoginValues = {
  username: '',
  password: '',
  newPassword: '',
  confirmation: '',
  otp: '',
  trustDevice: false,
};
