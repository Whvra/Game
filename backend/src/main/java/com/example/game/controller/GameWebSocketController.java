package com.example.game.controller;

import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.stereotype.Controller;

@Controller
public class GameWebSocketController {

    @MessageMapping("/game/state")
    @SendTo("/topic/game-state")
    public String broadcastGameState(String payload) {
        return payload;
    }
}
