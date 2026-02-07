import axios from 'axios';

export const cocoscanRequester = axios.create({
  baseURL: 'https://api2.bake-now.com/cocoscan',
});
