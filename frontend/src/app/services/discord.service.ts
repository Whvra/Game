import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class DiscordService {
  constructor(private http: HttpClient) {}

  notifyDiscord(message: string): Promise<string> {
    const params = new HttpParams().set('message', message);
    return firstValueFrom(this.http.post<{ code: string; message: string }>(`${environment.apiBaseUrl}/api/game/notify-discord`, null, { params }))
      .then(response => response.message || 'Message envoyé')
      .catch(error => {
        const status = error?.status;
        const statusText = error?.statusText || error?.message;
        if (status) {
          return `Erreur ${status}: ${statusText || 'réponse inconnue'}`;
        }
        return `Erreur réseau : ${statusText || 'backend inaccessible'}`;
      });
  }

  shareScore(token: string, player: string, score: number): Promise<string> {
    const params = new HttpParams()
      .set('token', token)
      .set('player', player)
      .set('score', String(score));
    const apiUrl = `${environment.apiBaseUrl}/api/game/share-score`;
    return firstValueFrom(this.http.post<{ code: string; message: string }>(apiUrl, null, { params }))
      .then(response => response.message || 'Score partagé')
      .catch(error => {
        const status = error?.status;
        const statusText = error?.statusText || error?.message;
        if (status) {
          return `Erreur ${status}: ${statusText || 'réponse inconnue'}`;
        }
        return `Erreur réseau : ${statusText || 'backend inaccessible'}`;
      });
  }
}
