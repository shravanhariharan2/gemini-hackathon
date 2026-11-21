import os
import uvicorn

if __name__ == '__main__':
    uvicorn.run('character_swap.server:app', host='0.0.0.0',
                port=int(os.environ.get('PORT', '8090')))
