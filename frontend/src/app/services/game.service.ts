import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { firstValueFrom } from 'rxjs';

export interface GameResult {
  score: number;
  totalScore: number;
  mode: string;
  detail: string;
}

@Injectable({
  providedIn: 'root'
})
export class GameService {
  constructor(private http: HttpClient) {}

  checkHealth(): Promise<string> {
    return firstValueFrom(this.http.get<{ code: string; message: string }>(`${environment.apiBaseUrl}/api/game/health`))
      .then(response => response.message)
      .catch(error => `Erreur: ${error.status || '??'}`);
  }

  shoot(mode: string): Promise<GameResult | string> {
    const params = new HttpParams().set('mode', mode);
    return firstValueFrom(this.http.post<GameResult>(`${environment.apiBaseUrl}/api/game/shoot`, null, { params }))
      .catch(error => `Erreur: ${error.status || '??'}`);
  }

  getStatus(): Promise<GameResult | string> {
    return firstValueFrom(this.http.get<GameResult>(`${environment.apiBaseUrl}/api/game/status`))
      .catch(error => `Erreur: ${error.status || '??'}`);
  }
}
